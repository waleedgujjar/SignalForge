import { prisma } from '@signalforge/database';
import { normalizeSubject } from '@signalforge/inbound';
import type { ThreadResolutionResult } from './types.js';

export interface ResolveThreadInput {
  workspaceId: string;
  mailboxId: string;
  fromEmail: string;
  subject?: string | null;
  inReplyTo?: string | null;
  references?: string[];
}

export async function resolveConversationThread(
  input: ResolveThreadInput,
): Promise<ThreadResolutionResult> {
  const messageIds = [
    input.inReplyTo,
    ...(input.references ?? []),
  ].filter((id): id is string => Boolean(id));

  if (messageIds.length > 0) {
    const byReply = await prisma.conversationMessage.findFirst({
      where: {
        workspaceId: input.workspaceId,
        OR: [
          { internetMessageId: { in: messageIds } },
          { providerMessageId: { in: messageIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { conversationId: true, inReplyTo: true },
    });

    if (byReply) {
      return {
        conversationId: byReply.conversationId,
        matchedBy: input.inReplyTo && messageIds[0] === input.inReplyTo ? 'IN_REPLY_TO' : 'REFERENCES',
      };
    }

    const outbound = await prisma.emailMessage.findFirst({
      where: {
        workspaceId: input.workspaceId,
        internetMessageId: { in: messageIds },
      },
      select: { id: true, campaignId: true, leadId: true, mailboxId: true },
    });

    if (outbound?.mailboxId === input.mailboxId) {
      const existing = await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
          leadId: outbound.leadId ?? undefined,
          campaignId: outbound.campaignId ?? undefined,
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      });
      if (existing) {
        return { conversationId: existing.id, matchedBy: 'IN_REPLY_TO' };
      }
    }
  }

  const normalizedSubject = normalizeSubject(input.subject);
  if (normalizedSubject) {
    const candidates = await prisma.conversation.findMany({
      where: {
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        subject: { not: null },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 25,
      select: { id: true, subject: true },
    });

    const match = candidates.find(
      (candidate: { id: string; subject: string | null }) =>
        normalizeSubject(candidate.subject) === normalizedSubject,
    );
    if (match) {
      return { conversationId: match.id, matchedBy: 'SUBJECT' };
    }
  }

  return { conversationId: null, matchedBy: 'NONE' };
}
