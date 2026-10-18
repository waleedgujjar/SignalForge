import type { Queue } from 'bullmq';
import { prisma, type Prisma } from '@signalforge/database';
import { enqueueInboxReply, type InboxReplyQueuePayload } from '@signalforge/queue';
import { messageService } from './message-service.js';
import { logInboxEvent } from './activity.js';
import type { SendReplyInput, SendReplyResult } from './types.js';

export class SendReplyService {
  constructor(private readonly inboxReplyQueue: Queue<InboxReplyQueuePayload>) {}

  async sendReply(input: SendReplyInput): Promise<SendReplyResult> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      include: {
        mailbox: { select: { id: true, emailAddress: true, fromName: true } },
        lead: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const recipientEmail = conversation.lead?.email;
    if (!recipientEmail) {
      throw new Error('No recipient email available for this conversation');
    }

    const latestInbound = await prisma.conversationMessage.findFirst({
      where: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        direction: 'INBOUND',
      },
      orderBy: { receivedAt: 'desc' },
      select: { internetMessageId: true, references: true },
    });

    const recipientName = [conversation.lead?.firstName, conversation.lead?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    const references = buildReferences(latestInbound?.references, latestInbound?.internetMessageId);

    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        mailboxId: conversation.mailboxId,
        direction: 'OUTBOUND',
        fromEmail: conversation.mailbox.emailAddress,
        fromName: conversation.mailbox.fromName,
        toRecipients: [
          {
            email: recipientEmail,
            ...(recipientName ? { name: recipientName } : {}),
          },
        ] as unknown as Prisma.InputJsonValue,
        ccRecipients: (input.ccRecipients ?? []) as unknown as Prisma.InputJsonValue,
        bccRecipients: (input.bccRecipients ?? []) as unknown as Prisma.InputJsonValue,
        subject: input.subject,
        textBody: input.body,
        htmlBodySanitized: messageService.sanitizeHtml(
          input.htmlBody ?? input.body.replace(/\n/g, '<br>'),
        ),
        inReplyTo: latestInbound?.internetMessageId ?? null,
        references: references as unknown as Prisma.InputJsonValue,
        status: 'DEFERRED',
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        type: 'MESSAGE_SENT',
        summary: `Outbound reply queued to ${recipientEmail}`,
        metadata: { messageId: message.id, subject: input.subject },
      },
    });

    const queueJob = await enqueueInboxReply(this.inboxReplyQueue, {
      conversationMessageId: message.id,
      workspaceId: input.workspaceId,
      mailboxId: conversation.mailboxId,
      conversationId: input.conversationId,
    });

    logInboxEvent('Outbound reply enqueued', {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: message.id,
      mailboxId: conversation.mailboxId,
      status: 'deferred',
    });

    return {
      conversationMessageId: message.id,
      queueJobId: queueJob.id ?? undefined,
    };
  }
}

function buildReferences(
  existing: Prisma.JsonValue | null | undefined,
  internetMessageId?: string | null,
): string[] {
  const refs: string[] = [];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string') refs.push(item);
    }
  }
  if (internetMessageId && !refs.includes(internetMessageId)) {
    refs.push(internetMessageId);
  }
  return refs;
}

export function createSendReplyService(
  inboxReplyQueue: Queue<InboxReplyQueuePayload>,
): SendReplyService {
  return new SendReplyService(inboxReplyQueue);
}
