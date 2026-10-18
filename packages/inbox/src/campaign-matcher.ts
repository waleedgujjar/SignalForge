import { prisma } from '@signalforge/database';
import type { CampaignMatchResult } from './types.js';

export interface MatchCampaignInput {
  workspaceId: string;
  mailboxId: string;
  leadId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
}

export async function matchCampaignContext(
  input: MatchCampaignInput,
): Promise<CampaignMatchResult> {
  const messageIds = [
    input.inReplyTo,
    ...(input.references ?? []),
  ].filter((id): id is string => Boolean(id));

  if (messageIds.length > 0) {
    const outbound = await prisma.emailMessage.findFirst({
      where: {
        workspaceId: input.workspaceId,
        internetMessageId: { in: messageIds },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        campaignId: true,
        campaignLeadId: true,
        leadId: true,
        mailboxId: true,
      },
    });

    if (outbound?.campaignId) {
      return {
        campaignId: outbound.campaignId,
        campaignLeadId: outbound.campaignLeadId,
        emailMessageId: outbound.id,
        matchStatus: outbound.mailboxId === input.mailboxId ? 'MATCHED' : 'PARTIAL',
      };
    }

    const priorInbound = await prisma.conversationMessage.findFirst({
      where: {
        workspaceId: input.workspaceId,
        internetMessageId: { in: messageIds },
      },
      include: {
        conversation: {
          select: { campaignId: true, campaignLeadId: true },
        },
        emailMessage: {
          select: { id: true, campaignId: true, campaignLeadId: true },
        },
      },
    });

    if (priorInbound?.conversation.campaignId) {
      return {
        campaignId: priorInbound.conversation.campaignId,
        campaignLeadId: priorInbound.conversation.campaignLeadId,
        emailMessageId: priorInbound.emailMessageId,
        matchStatus: 'MATCHED',
      };
    }
  }

  if (input.leadId) {
    const activeEnrollment = await prisma.campaignLead.findFirst({
      where: {
        leadId: input.leadId,
        status: { in: ['PENDING', 'ACTIVE', 'PAUSED'] },
        campaign: {
          workspaceId: input.workspaceId,
          status: { in: ['ACTIVE', 'PAUSED'] },
          OR: [
            { mailboxId: input.mailboxId },
            { mailboxes: { some: { mailboxId: input.mailboxId } } },
          ],
        },
      },
      orderBy: { enrolledAt: 'desc' },
      select: { id: true, campaignId: true },
    });

    if (activeEnrollment) {
      return {
        campaignId: activeEnrollment.campaignId,
        campaignLeadId: activeEnrollment.id,
        emailMessageId: null,
        matchStatus: 'PARTIAL',
      };
    }
  }

  return {
    campaignId: null,
    campaignLeadId: null,
    emailMessageId: null,
    matchStatus: 'UNMATCHED',
  };
}
