import { prisma } from '@signalforge/database';
import type { ConversationStatus, ReplyClassification } from '@signalforge/database';
import type { InboxStats } from './types.js';

export class StatsService {
  async getWorkspaceStats(workspaceId: string, mailboxId?: string): Promise<InboxStats> {
    const where = {
      workspaceId,
      ...(mailboxId ? { mailboxId } : {}),
    };

    const [
      totalConversations,
      openConversations,
      needsResponse,
      unreadAggregate,
      classificationGroups,
      statusGroups,
    ] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.count({ where: { ...where, status: 'OPEN' } }),
      prisma.conversation.count({ where: { ...where, status: 'NEEDS_RESPONSE' } }),
      prisma.conversation.aggregate({
        where,
        _sum: { unreadCount: true },
      }),
      prisma.conversation.groupBy({
        by: ['classification'],
        where: { ...where, classification: { not: null } },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    const byClassification: Partial<Record<ReplyClassification, number>> = {};
    for (const row of classificationGroups) {
      if (row.classification) {
        byClassification[row.classification] = row._count._all;
      }
    }

    const byStatus: Partial<Record<ConversationStatus, number>> = {};
    for (const row of statusGroups) {
      byStatus[row.status] = row._count._all;
    }

    return {
      totalConversations,
      openConversations,
      needsResponse,
      unreadCount: unreadAggregate._sum.unreadCount ?? 0,
      byClassification,
      byStatus,
    };
  }

  async getMailboxSyncHealth(workspaceId: string) {
    return prisma.mailbox.findMany({
      where: { workspaceId, inboundEnabled: true },
      select: {
        id: true,
        emailAddress: true,
        inboundStatus: true,
        lastInboundSyncAt: true,
        lastInboundError: true,
        syncState: {
          select: {
            status: true,
            lastSyncAt: true,
            lastSuccessAt: true,
            lastMessageUid: true,
            lastError: true,
          },
        },
      },
      orderBy: { emailAddress: 'asc' },
    });
  }
}

export const statsService = new StatsService();
