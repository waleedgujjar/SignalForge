import { prisma } from '@signalforge/database';
import type { Prisma, ReplyClassification } from '@signalforge/database';
import { countersService } from '@signalforge/deliverability';
import { endOfUtcDay, startOfUtcDay } from './metrics/range.js';
import {
  POSITIVE_CLASSIFICATIONS,
  contactedFilter,
  repliedFilter,
} from './metrics/counters.js';

export interface AnalyticsAggregationResult {
  workspaceId: string;
  snapshotDate: string;
  leadsCreated: number;
  sent: number;
}

/**
 * Rolls one workspace-day into `WorkspaceAnalyticsSnapshot`.
 *
 * The upsert is keyed on `(workspaceId, snapshotDate)`, so re-running the job
 * for a day it has already processed overwrites the row instead of
 * double-counting. That matters because the scheduler deliberately re-queues
 * today and yesterday on every tick to pick up late-arriving events.
 */
export class AnalyticsAggregationService {
  async aggregateWorkspaceDay(
    workspaceId: string,
    day: Date,
  ): Promise<AnalyticsAggregationResult> {
    const from = startOfUtcDay(day);
    const to = endOfUtcDay(day);
    const dayFilter = { gte: from, lte: to };
    const cohort: Prisma.LeadWhereInput = { workspaceId, createdAt: dayFilter };

    const [
      counters,
      leadsCreated,
      leadsVerified,
      leadsQualified,
      leadsContacted,
      leadsReplied,
      positiveReplies,
      meetingsBooked,
      conversions,
      verificationRows,
      replyRows,
      warmupTotals,
    ] = await Promise.all([
      countersService.getCounters({ workspaceId, from, to }),
      prisma.lead.count({ where: cohort }),
      prisma.leadVerification.count({
        where: { status: 'VERIFIED', verifiedAt: dayFilter, lead: { workspaceId } },
      }),
      prisma.lead.count({ where: { workspaceId, status: 'QUALIFIED', updatedAt: dayFilter } }),
      prisma.lead.count({ where: { ...cohort, ...contactedFilter() } }),
      prisma.lead.count({ where: { ...cohort, ...repliedFilter() } }),
      prisma.conversation.count({
        where: {
          workspaceId,
          firstReplyAt: dayFilter,
          classification: { in: [...POSITIVE_CLASSIFICATIONS] },
        },
      }),
      prisma.leadOutcomeEvent.count({
        where: { workspaceId, type: 'MEETING_BOOKED', occurredAt: dayFilter },
      }),
      prisma.leadOutcomeEvent.count({
        where: { workspaceId, type: 'CONVERTED', occurredAt: dayFilter },
      }),
      prisma.leadVerification.groupBy({
        by: ['status'],
        where: { lead: cohort },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ['classification'],
        where: { workspaceId, firstReplyAt: dayFilter },
        _count: { _all: true },
      }),
      prisma.warmupDailyHistory.aggregate({
        where: { workspaceId, usageDate: from },
        _sum: { sentCount: true, failedCount: true },
      }),
    ]);

    const byStatus = new Map(verificationRows.map((row) => [row.status, row._count._all]));
    const replyBreakdown: Record<string, number> = {};
    for (const row of replyRows) {
      const key: ReplyClassification | 'UNCLASSIFIED' = row.classification ?? 'UNCLASSIFIED';
      replyBreakdown[key] = row._count._all;
    }

    const data = {
      leadsCreated,
      leadsVerified,
      leadsQualified,
      leadsContacted,
      leadsReplied,
      positiveReplies,
      meetingsBooked,
      conversions,
      sent: counters.sent,
      delivered: counters.delivered,
      bounced: counters.bounced,
      hardBounces: counters.hardBounces,
      softBounces: counters.softBounces,
      failed: counters.failed,
      replies: counters.replies,
      unsubscribes: counters.unsubscribes,
      complaints: counters.complaints,
      verifiedCount: byStatus.get('VERIFIED') ?? 0,
      invalidCount: byStatus.get('INVALID') ?? 0,
      riskyCount: byStatus.get('RISKY') ?? 0,
      unknownCount: byStatus.get('UNKNOWN') ?? 0,
      warmupSent: warmupTotals._sum.sentCount ?? 0,
      warmupFailed: warmupTotals._sum.failedCount ?? 0,
      replyBreakdown,
    };

    await prisma.workspaceAnalyticsSnapshot.upsert({
      where: { workspaceId_snapshotDate: { workspaceId, snapshotDate: from } },
      create: { workspaceId, snapshotDate: from, ...data },
      update: data,
    });

    return {
      workspaceId,
      snapshotDate: from.toISOString().slice(0, 10),
      leadsCreated,
      sent: counters.sent,
    };
  }

  /**
   * Workspaces worth aggregating for the window: anything that sent, imported a
   * lead, received a reply, or logged an outcome. Idle tenants are skipped so
   * the queue does not grow with the customer count.
   */
  async findActiveWorkspaces(from: Date, to: Date): Promise<string[]> {
    const window = { gte: from, lte: to };
    const [events, leads, conversations, outcomes] = await Promise.all([
      prisma.emailDeliveryEvent.groupBy({ by: ['workspaceId'], where: { occurredAt: window } }),
      prisma.lead.groupBy({ by: ['workspaceId'], where: { createdAt: window } }),
      prisma.conversation.groupBy({ by: ['workspaceId'], where: { firstReplyAt: window } }),
      prisma.leadOutcomeEvent.groupBy({ by: ['workspaceId'], where: { occurredAt: window } }),
    ]);

    return [
      ...new Set([
        ...events.map((row) => row.workspaceId),
        ...leads.map((row) => row.workspaceId),
        ...conversations.map((row) => row.workspaceId),
        ...outcomes.map((row) => row.workspaceId),
      ]),
    ];
  }
}

export const analyticsAggregationService = new AnalyticsAggregationService();
