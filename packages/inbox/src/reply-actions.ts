import { prisma } from '@signalforge/database';
import type { CampaignLeadStopReason, ReplyClassification } from '@signalforge/database';
import { buildIdempotencyKey, deliveryEventService } from '@signalforge/deliverability';
import { publishWorkflowEvent } from '@signalforge/automations';
import { sendingJobService } from '@signalforge/sending';
import { logInboxEvent } from './activity.js';
import { parseReplyHandlingPolicy } from './types.js';

export interface ApplyReplyActionsInput {
  workspaceId: string;
  conversationId: string;
  campaignId?: string | null;
  campaignLeadId?: string | null;
  leadId?: string | null;
  mailboxId?: string | null;
  inboundMessageId?: string | null;
  fromEmail: string;
  classification: ReplyClassification;
  replyHandlingPolicy?: unknown;
}

export interface ApplyReplyActionsResult {
  campaignPaused: boolean;
  campaignStopped: boolean;
  leadUnsubscribed: boolean;
  conversationArchived: boolean;
  suppressionAdded: boolean;
}

const POSITIVE_CLASSIFICATIONS = [
  'INTERESTED',
  'QUESTION',
  'NEEDS_FOLLOW_UP',
  'POSITIVE',
  'REFERRAL',
] as const;

const NEGATIVE_CLASSIFICATIONS = ['NOT_INTERESTED', 'WRONG_PERSON', 'SPAM_COMPLAINT'] as const;

export function mapReplyToStopReason(
  classification: ReplyClassification,
): CampaignLeadStopReason {
  if (classification === 'UNSUBSCRIBE') return 'UNSUBSCRIBED';
  if (NEGATIVE_CLASSIFICATIONS.includes(classification as (typeof NEGATIVE_CLASSIFICATIONS)[number])) {
    return 'NEGATIVE_REPLY';
  }
  if (POSITIVE_CLASSIFICATIONS.includes(classification as (typeof POSITIVE_CLASSIFICATIONS)[number])) {
    return 'POSITIVE_REPLY';
  }
  return 'REPLIED';
}

export async function applyReplyActions(
  input: ApplyReplyActionsInput,
): Promise<ApplyReplyActionsResult> {
  const policy = parseReplyHandlingPolicy(input.replyHandlingPolicy);
  const result: ApplyReplyActionsResult = {
    campaignPaused: false,
    campaignStopped: false,
    leadUnsubscribed: false,
    conversationArchived: false,
    suppressionAdded: false,
  };

  await recordReplyEvent(input);
  await emitReplyWorkflowEvents(input);

  if (input.classification === 'UNSUBSCRIBE' && policy.detectUnsubscribe) {
    await handleUnsubscribe(input, result);
    return result;
  }

  if (input.classification === 'OUT_OF_OFFICE') {
    if (policy.autoArchiveOoo) {
      await archiveConversation(input.conversationId, input.workspaceId);
      result.conversationArchived = true;
    }
    return result;
  }

  if (input.leadId) {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: { status: 'REPLIED' },
    });
  }

  const stopReason = mapReplyToStopReason(input.classification);

  if (policy.stopOnReply) {
    await stopEnrollment(input, result, stopReason);
    if (POSITIVE_CLASSIFICATIONS.includes(input.classification as (typeof POSITIVE_CLASSIFICATIONS)[number])) {
      await markConversationNeedsResponse(input.conversationId, input.workspaceId);
    }
    return result;
  }

  if (policy.pauseOnReply) {
    await pauseEnrollment(input, result, stopReason);
    if (POSITIVE_CLASSIFICATIONS.includes(input.classification as (typeof POSITIVE_CLASSIFICATIONS)[number])) {
      await markConversationNeedsResponse(input.conversationId, input.workspaceId);
    }
  }

  return result;
}

async function handleUnsubscribe(
  input: ApplyReplyActionsInput,
  result: ApplyReplyActionsResult,
): Promise<void> {
  const email = input.fromEmail.trim().toLowerCase();

  await prisma.$transaction(async (tx) => {
    await tx.suppression.upsert({
      where: {
        workspaceId_type_value: {
          workspaceId: input.workspaceId,
          type: 'EMAIL',
          value: email,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        type: 'EMAIL',
        value: email,
        reason: 'UNSUBSCRIBED',
        source: 'INBOX',
      },
      update: {
        reason: 'UNSUBSCRIBED',
        source: 'INBOX',
      },
    });

    if (input.leadId) {
      await tx.lead.update({
        where: { id: input.leadId },
        data: { status: 'UNSUBSCRIBED' },
      });
      result.leadUnsubscribed = true;
    }

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        status: 'UNSUBSCRIBED',
        classification: 'UNSUBSCRIBE',
        archivedAt: new Date(),
      },
    });

    await tx.conversationActivity.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        type: 'LEAD_UNSUBSCRIBED',
        summary: `Lead unsubscribed via reply from ${email}`,
        metadata: { email },
      },
    });
  });

  if (input.campaignLeadId) {
    await sendingJobService.stopCampaignLeadSequence({
      campaignLeadId: input.campaignLeadId,
      workspaceId: input.workspaceId,
      stopReason: 'UNSUBSCRIBED',
      campaignLeadStatus: 'UNSUBSCRIBED',
    });
    result.campaignStopped = true;
  }

  result.suppressionAdded = true;
  result.conversationArchived = true;

  await deliveryEventService.recordEvent({
    workspaceId: input.workspaceId,
    eventType: 'UNSUBSCRIBE',
    idempotencyKey: buildIdempotencyKey(['unsubscribe', input.conversationId, email]),
    mailboxId: input.mailboxId ?? null,
    leadId: input.leadId ?? null,
    campaignId: input.campaignId ?? null,
    source: 'INBOX',
    metadata: { conversationId: input.conversationId },
  });

  logInboxEvent('Lead unsubscribed from reply', {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    status: 'unsubscribed',
  });
}

async function stopEnrollment(
  input: ApplyReplyActionsInput,
  result: ApplyReplyActionsResult,
  stopReason: CampaignLeadStopReason,
): Promise<void> {
  if (!input.campaignLeadId) return;

  await sendingJobService.stopCampaignLeadSequence({
    campaignLeadId: input.campaignLeadId,
    workspaceId: input.workspaceId,
    stopReason,
    campaignLeadStatus: stopReason === 'NEGATIVE_REPLY' ? 'COMPLETED' : 'PAUSED',
  });

  await prisma.conversationActivity.create({
    data: {
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      type: 'CAMPAIGN_STOPPED',
      summary: 'Automated follow-ups stopped due to reply',
      metadata: { stopReason, classification: input.classification },
    },
  });

  result.campaignStopped = true;
}

async function pauseEnrollment(
  input: ApplyReplyActionsInput,
  result: ApplyReplyActionsResult,
  stopReason: CampaignLeadStopReason,
): Promise<void> {
  if (!input.campaignLeadId) return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.campaignLead.update({
      where: { id: input.campaignLeadId! },
      data: {
        status: 'PAUSED',
        stopReason,
        stoppedAt: now,
        repliedAt: now,
        lastReplyAt: now,
      },
    });
    await tx.sendingJob.updateMany({
      where: {
        campaignLeadId: input.campaignLeadId!,
        status: { in: ['PENDING', 'SCHEDULED', 'RETRYING'] },
      },
      data: { status: 'PAUSED', pausedAt: now },
    });
    await tx.conversationActivity.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        type: 'CAMPAIGN_PAUSED',
        summary: 'Campaign enrollment paused due to reply',
        metadata: { stopReason, classification: input.classification },
      },
    });
  });

  result.campaignPaused = true;
}

async function recordReplyEvent(input: ApplyReplyActionsInput): Promise<void> {
  await deliveryEventService.recordEvent({
    workspaceId: input.workspaceId,
    eventType: 'REPLY',
    idempotencyKey: buildIdempotencyKey([
      'reply',
      input.inboundMessageId ?? input.conversationId,
      input.fromEmail.trim().toLowerCase(),
    ]),
    mailboxId: input.mailboxId ?? null,
    leadId: input.leadId ?? null,
    campaignId: input.campaignId ?? null,
    source: 'INBOX',
    metadata: { classification: input.classification, conversationId: input.conversationId },
  });
}

async function emitReplyWorkflowEvents(input: ApplyReplyActionsInput): Promise<void> {
  if (!input.leadId) return;

  const baseKey = buildIdempotencyKey([
    'workflow-reply',
    input.inboundMessageId ?? input.conversationId,
    input.fromEmail.trim().toLowerCase(),
  ]);

  void publishWorkflowEvent({
    eventType: 'EMAIL_REPLIED',
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    campaignId: input.campaignId ?? undefined,
    mailboxId: input.mailboxId ?? undefined,
    conversationId: input.conversationId,
    idempotencyKey: `${baseKey}:EMAIL_REPLIED`,
    metadata: {
      classification: input.classification,
      replyClassification: input.classification,
      hasReplied: true,
    },
  }).catch(() => {});

  if (input.classification === 'UNSUBSCRIBE') {
    void publishWorkflowEvent({
      eventType: 'UNSUBSCRIBE_RECEIVED',
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      campaignId: input.campaignId ?? undefined,
      conversationId: input.conversationId,
      idempotencyKey: `${baseKey}:UNSUBSCRIBE_RECEIVED`,
    }).catch(() => {});
    return;
  }

  if (POSITIVE_CLASSIFICATIONS.includes(input.classification as (typeof POSITIVE_CLASSIFICATIONS)[number])) {
    void publishWorkflowEvent({
      eventType: 'POSITIVE_REPLY_RECEIVED',
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      campaignId: input.campaignId ?? undefined,
      conversationId: input.conversationId,
      idempotencyKey: `${baseKey}:POSITIVE_REPLY_RECEIVED`,
      metadata: { classification: input.classification, replyClassification: input.classification },
    }).catch(() => {});
  }

  if (NEGATIVE_CLASSIFICATIONS.includes(input.classification as (typeof NEGATIVE_CLASSIFICATIONS)[number])) {
    void publishWorkflowEvent({
      eventType: 'NEGATIVE_REPLY_RECEIVED',
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      campaignId: input.campaignId ?? undefined,
      conversationId: input.conversationId,
      idempotencyKey: `${baseKey}:NEGATIVE_REPLY_RECEIVED`,
      metadata: { classification: input.classification, replyClassification: input.classification },
    }).catch(() => {});
  }
}

async function archiveConversation(conversationId: string, workspaceId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  await prisma.conversationActivity.create({
    data: {
      conversationId,
      workspaceId,
      type: 'ARCHIVED',
      summary: 'Conversation archived automatically (out of office)',
    },
  });
}

async function markConversationNeedsResponse(
  conversationId: string,
  workspaceId: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'NEEDS_RESPONSE' },
  });
  await prisma.conversationActivity.create({
    data: {
      conversationId,
      workspaceId,
      type: 'CLASSIFIED',
      summary: 'Conversation marked as needs response',
    },
  });
}
