import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import type { AnalyticsFilters } from '../types.js';

export interface LeadWindow {
  workspaceId: string;
  from: Date;
  to: Date;
  filters?: AnalyticsFilters;
}

export interface FunnelCounts {
  imported: number;
  verified: number;
  qualified: number;
  contacted: number;
  replied: number;
  positiveReply: number;
  meeting: number;
}

/// Classifications the product treats as a positive outcome. Kept in one place
/// because Module 12 emits several enum values that all mean "interested".
export const POSITIVE_CLASSIFICATIONS = ['POSITIVE', 'INTERESTED'] as const;
export const NEGATIVE_CLASSIFICATIONS = ['NEGATIVE', 'NOT_INTERESTED', 'WRONG_PERSON'] as const;

/**
 * Lead-side counters for the analytics funnel and dimensional tables.
 *
 * Every query is filtered on `workspaceId` at the top level — analytics reads
 * across most tables in the product, so tenant scoping is applied here rather
 * than trusted to callers.
 *
 * The funnel is a **cohort**: it follows leads created inside the range and
 * reports how far each has progressed. Stage counts therefore lag for short
 * ranges, which is why the KPI cards use in-range activity counts instead.
 */
export class AnalyticsCountersService {
  /// Base filter for the lead cohort, honouring dimensional filters.
  private leadWhere(window: LeadWindow): Prisma.LeadWhereInput {
    const filters = window.filters ?? {};
    return {
      workspaceId: window.workspaceId,
      createdAt: { gte: window.from, lte: window.to },
      ...(filters.source ? { source: filters.source as Prisma.LeadWhereInput['source'] } : {}),
      ...(filters.industry ? { industry: filters.industry } : {}),
      ...(filters.country ? { country: filters.country } : {}),
      ...(filters.campaignId
        ? { campaignLeads: { some: { campaignId: filters.campaignId } } }
        : {}),
    };
  }

  async getFunnelCounts(window: LeadWindow): Promise<FunnelCounts> {
    const base = this.leadWhere(window);

    const [imported, verified, qualified, contacted, replied, positiveReply, meeting] =
      await Promise.all([
        prisma.lead.count({ where: base }),
        prisma.lead.count({ where: { ...base, verification: { status: 'VERIFIED' } } }),
        prisma.lead.count({ where: { ...base, ...qualifiedFilter() } }),
        prisma.lead.count({ where: { ...base, ...contactedFilter() } }),
        prisma.lead.count({ where: { ...base, ...repliedFilter() } }),
        prisma.lead.count({ where: { ...base, ...positiveReplyFilter() } }),
        prisma.lead.count({
          where: { ...base, outcomeEvents: { some: { type: 'MEETING_BOOKED' } } },
        }),
      ]);

    return { imported, verified, qualified, contacted, replied, positiveReply, meeting };
  }

  /// Counts of things that *happened* inside the range, which is what the KPI
  /// cards compare period-over-period.
  async getActivityCounts(window: LeadWindow) {
    const { workspaceId, from, to } = window;
    const [leadsCreated, leadsVerified, leadsQualified, meetings, conversions] = await Promise.all([
      prisma.lead.count({ where: this.leadWhere(window) }),
      prisma.leadVerification.count({
        where: {
          status: 'VERIFIED',
          verifiedAt: { gte: from, lte: to },
          lead: { workspaceId },
        },
      }),
      prisma.lead.count({
        where: { workspaceId, status: 'QUALIFIED', updatedAt: { gte: from, lte: to } },
      }),
      prisma.leadOutcomeEvent.count({
        where: { workspaceId, type: 'MEETING_BOOKED', occurredAt: { gte: from, lte: to } },
      }),
      prisma.leadOutcomeEvent.count({
        where: { workspaceId, type: 'CONVERTED', occurredAt: { gte: from, lte: to } },
      }),
    ]);

    return { leadsCreated, leadsVerified, leadsQualified, meetings, conversions };
  }

  /**
   * Groups the lead cohort by a stored scalar column and counts progression at
   * each stage. Five aggregates per dimension keeps the numbers exact without
   * loading lead rows into memory.
   */
  async groupByDimension(
    window: LeadWindow,
    field: 'source' | 'industry' | 'country' | 'jobTitle',
  ): Promise<Map<string, DimensionCounts>> {
    const base = this.leadWhere(window);
    const group = (where: Prisma.LeadWhereInput): Promise<GroupedCount[]> =>
      prisma.lead.groupBy({
        by: [field],
        where,
        _count: { _all: true },
      }) as unknown as Promise<GroupedCount[]>;

    const [leads, contacted, replied, positive, meetings] = await Promise.all([
      group(base),
      group({ ...base, ...contactedFilter() }),
      group({ ...base, ...repliedFilter() }),
      group({ ...base, ...positiveReplyFilter() }),
      group({ ...base, outcomeEvents: { some: { type: 'MEETING_BOOKED' } } }),
    ]);

    const result = new Map<string, DimensionCounts>();
    const bucket = (key: string): DimensionCounts => {
      const existing = result.get(key);
      if (existing) return existing;
      const created: DimensionCounts = {
        leads: 0,
        contacted: 0,
        replies: 0,
        positiveReplies: 0,
        meetings: 0,
      };
      result.set(key, created);
      return created;
    };

    const keyOf = (row: GroupedCount): string => (row[field] as string | null) ?? 'Unknown';

    for (const row of leads) bucket(keyOf(row)).leads += row._count._all;
    for (const row of contacted) bucket(keyOf(row)).contacted += row._count._all;
    for (const row of replied) bucket(keyOf(row)).replies += row._count._all;
    for (const row of positive) bucket(keyOf(row)).positiveReplies += row._count._all;
    for (const row of meetings) bucket(keyOf(row)).meetings += row._count._all;

    return result;
  }

  /// Verification outcomes for the lead cohort, used by the leads view.
  async getVerificationBreakdown(window: LeadWindow) {
    const rows = await prisma.leadVerification.groupBy({
      by: ['status'],
      where: { lead: this.leadWhere(window) },
      _count: { _all: true },
    });
    const byStatus = new Map(rows.map((row) => [row.status, row._count._all]));
    return {
      verified: byStatus.get('VERIFIED') ?? 0,
      invalid: byStatus.get('INVALID') ?? 0,
      risky: byStatus.get('RISKY') ?? 0,
      unknown: byStatus.get('UNKNOWN') ?? 0,
      disposable: byStatus.get('DISPOSABLE') ?? 0,
      roleBased: byStatus.get('ROLE_BASED') ?? 0,
    };
  }
}

/// `groupBy` is called with a runtime-chosen column, so Prisma cannot infer the
/// row shape; this is the shape every one of those aggregates returns.
type GroupedCount = Record<string, unknown> & { _count: { _all: number } };

export interface DimensionCounts {
  leads: number;
  contacted: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
}

/// Qualified means an explicit status or a strong enrichment signal — the two
/// paths a lead can take to be considered worth contacting.
export function qualifiedFilter(): Prisma.LeadWhereInput {
  return {
    OR: [
      { status: 'QUALIFIED' },
      { enrichment: { prospectPriority: { in: ['HIGH', 'VERY_HIGH'] } } },
    ],
  };
}

/// A lead counts as contacted once a send actually succeeded; the status alone
/// would miss leads whose status moved on to REPLIED.
export function contactedFilter(): Prisma.LeadWhereInput {
  return {
    OR: [
      { status: { in: ['CONTACTED', 'REPLIED', 'CONVERTED'] } },
      { sendingJobs: { some: { status: 'SENT' } } },
    ],
  };
}

export function repliedFilter(): Prisma.LeadWhereInput {
  return {
    OR: [{ status: 'REPLIED' }, { conversations: { some: { firstReplyAt: { not: null } } } }],
  };
}

export function positiveReplyFilter(): Prisma.LeadWhereInput {
  return {
    conversations: { some: { classification: { in: [...POSITIVE_CLASSIFICATIONS] } } },
  };
}

export const analyticsCountersService = new AnalyticsCountersService();
