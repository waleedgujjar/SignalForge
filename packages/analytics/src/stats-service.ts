import { Prisma, prisma } from '@signalforge/database';
import {
  EMPTY_COUNTERS,
  calculateRates,
  countersService,
  sumCounters,
} from '@signalforge/deliverability';
import {
  NEGATIVE_CLASSIFICATIONS,
  POSITIVE_CLASSIFICATIONS,
  analyticsCountersService,
  type LeadWindow,
} from './metrics/counters.js';
import {
  average,
  buildTrend,
  leadRate,
  median,
  sendRate,
} from './metrics/formulas.js';
import { eachUtcDay, previousRange, startOfUtcDay, toDateKey } from './metrics/range.js';
import { buildFunnel, funnelService } from './funnel-service.js';
import { buildInsights } from './insights-service.js';
import {
  OPEN_TRACKING_NOTE,
  type AnalyticsFilters,
  type AnalyticsOverview,
  type AnalyticsRange,
  type CampaignAnalyticsRow,
  type DailyActivity,
  type DeliveryCounters,
  type DimensionRow,
  type DiscoveryAnalytics,
  type ImportAnalytics,
  type KpiCard,
  type MailboxAnalyticsRow,
  type MeetingAnalytics,
  type ReplyAnalytics,
  type SequenceStepRow,
  type SmtpPoolRow,
  type SubjectRow,
  type TimelinePoint,
  type VerificationAnalytics,
  type WarmupAnalytics,
  type WebsiteIntelligenceAnalytics,
} from './types.js';

/// Upper bound on replies pulled into memory for step/subject attribution.
/// Well above realistic reply volume for a single range, but keeps a runaway
/// query from loading an unbounded result set.
const MAX_ATTRIBUTED_REPLIES = 5_000;

/// Limitations surfaced in the UI so a missing metric is never read as a zero.
export const ANALYTICS_LIMITATIONS = [
  OPEN_TRACKING_NOTE,
  'Meetings are counted from manually or API-recorded outcomes; there is no calendar integration yet.',
  'Revenue and ROI are not tracked, so no monetary figures are shown.',
  'CSV uploads are processed inline and do not appear in import history.',
];

export interface StatsWindow {
  workspaceId: string;
  range: AnalyticsRange;
  filters?: AnalyticsFilters;
}

/**
 * Single source of truth for every analytics number in the product.
 *
 * Email rates are always delegated to `@signalforge/deliverability`; this
 * service composes them with lead, reply, and outcome data. Nothing here
 * estimates a value it cannot measure.
 */
export class AnalyticsStatsService {
  async getOverview(input: StatsWindow): Promise<AnalyticsOverview> {
    const { workspaceId, range, filters } = input;
    const previous = previousRange(range);
    const leadWindow: LeadWindow = { workspaceId, from: range.from, to: range.to, filters };

    const [
      counters,
      previousCounters,
      activity,
      previousActivity,
      funnel,
      timeline,
      replies,
      meetings,
      campaigns,
      mailboxes,
    ] = await Promise.all([
      countersService.getCounters({
        workspaceId,
        from: range.from,
        to: range.to,
        campaignId: filters?.campaignId,
        mailboxId: filters?.mailboxId,
      }),
      countersService.getCounters({
        workspaceId,
        from: previous.from,
        to: previous.to,
        campaignId: filters?.campaignId,
        mailboxId: filters?.mailboxId,
      }),
      analyticsCountersService.getActivityCounts(leadWindow),
      analyticsCountersService.getActivityCounts({
        workspaceId,
        from: previous.from,
        to: previous.to,
        filters,
      }),
      funnelService.getFunnel(leadWindow),
      this.getTimeline(input),
      this.getReplyAnalytics(input),
      this.getMeetingAnalytics(input),
      this.getCampaignRows(input),
      this.getMailboxRows(input),
    ]);

    const rates = calculateRates(counters);
    const previousRates = calculateRates(previousCounters);

    const kpis: KpiCard[] = [
      kpi('leadsCreated', 'Leads imported', activity.leadsCreated, previousActivity.leadsCreated),
      kpi('leadsVerified', 'Leads verified', activity.leadsVerified, previousActivity.leadsVerified),
      kpi(
        'leadsQualified',
        'Leads qualified',
        activity.leadsQualified,
        previousActivity.leadsQualified,
      ),
      kpi('sent', 'Emails sent', counters.sent, previousCounters.sent),
      kpi('delivered', 'Emails delivered', counters.delivered, previousCounters.delivered),
      kpi('replies', 'Replies', counters.replies, previousCounters.replies),
      kpi('positiveReplies', 'Positive replies', replies.positive, 0),
      {
        ...kpi('meetings', 'Meetings booked', activity.meetings, previousActivity.meetings),
        note: meetings.manualEntryOnly
          ? 'Recorded manually or via API. No calendar integration yet.'
          : undefined,
      },
    ];

    return {
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        period: range.period,
        days: range.days,
      },
      previousRange: { from: previous.from.toISOString(), to: previous.to.toISOString() },
      kpis,
      counters,
      rates,
      funnel,
      timeline,
      replies,
      meetings,
      topCampaigns: campaigns.slice(0, 5),
      topMailboxes: mailboxes.slice(0, 5),
      insights: buildInsights({
        counters,
        rates,
        previousRates,
        funnel,
        replies,
        campaigns,
        mailboxes,
      }),
      limitations: ANALYTICS_LIMITATIONS,
    };
  }

  /**
   * Daily email performance series.
   *
   * Reads the pre-aggregated daily snapshot where one exists and computes the
   * remainder live. Today's bucket is always live, since its snapshot is at
   * best a few minutes stale.
   */
  async getTimeline(input: StatsWindow): Promise<TimelinePoint[]> {
    const { workspaceId, range, filters } = input;
    const days = eachUtcDay(range);
    const today = startOfUtcDay(new Date()).getTime();

    // Filtered views cannot use the workspace-wide rollup.
    const useSnapshots = !filters?.campaignId && !filters?.mailboxId;
    const snapshots = useSnapshots
      ? await prisma.workspaceAnalyticsSnapshot.findMany({
          where: { workspaceId, snapshotDate: { gte: days[0], lte: days[days.length - 1] } },
          orderBy: { snapshotDate: 'asc' },
        })
      : [];

    const byDate = new Map(snapshots.map((row) => [toDateKey(row.snapshotDate), row]));
    const missing = days.filter((day) => day.getTime() >= today || !byDate.has(toDateKey(day)));
    const live = missing.length > 0 ? await this.computeDailyBuckets(input, missing) : new Map();

    return days.map((day) => {
      const key = toDateKey(day);
      const liveBucket = live.get(key);
      const snapshot = byDate.get(key);
      const counters: DeliveryCounters =
        liveBucket ??
        (snapshot
          ? {
              ...EMPTY_COUNTERS,
              attempted: snapshot.sent + snapshot.bounced + snapshot.failed,
              sent: snapshot.sent,
              delivered: snapshot.delivered,
              bounced: snapshot.bounced,
              hardBounces: snapshot.hardBounces,
              softBounces: snapshot.softBounces,
              failed: snapshot.failed,
              replies: snapshot.replies,
              uniqueRepliedLeads: snapshot.replies,
              unsubscribes: snapshot.unsubscribes,
              complaints: snapshot.complaints,
            }
          : { ...EMPTY_COUNTERS });

      const rates = calculateRates(counters);
      return {
        date: key,
        sent: counters.sent,
        delivered: counters.delivered,
        bounced: counters.bounced,
        failed: counters.failed,
        replies: counters.replies,
        unsubscribes: counters.unsubscribes,
        deliveryRate: rates.deliveryRate,
        bounceRate: rates.bounceRate,
        replyRate: rates.replyRate,
      };
    });
  }

  /// Buckets raw delivery events by UTC day for the given days.
  private async computeDailyBuckets(
    input: StatsWindow,
    days: Date[],
  ): Promise<Map<string, DeliveryCounters>> {
    const { workspaceId, filters } = input;
    const from = days[0]!;
    const to = new Date(days[days.length - 1]!.getTime() + 86_399_999);

    const events = await prisma.emailDeliveryEvent.findMany({
      where: {
        workspaceId,
        occurredAt: { gte: from, lte: to },
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
      },
      select: { occurredAt: true, eventType: true, bounceType: true },
      take: 50_000,
    });

    const buckets = new Map<string, DeliveryCounters>();
    for (const day of days) buckets.set(toDateKey(day), { ...EMPTY_COUNTERS });

    for (const event of events) {
      const bucket = buckets.get(toDateKey(event.occurredAt));
      if (!bucket) continue;
      switch (event.eventType) {
        case 'SENT':
          bucket.sent += 1;
          break;
        case 'DELIVERED':
          bucket.delivered += 1;
          break;
        case 'BOUNCED':
          bucket.bounced += 1;
          if (event.bounceType === 'HARD') bucket.hardBounces += 1;
          if (event.bounceType === 'SOFT') bucket.softBounces += 1;
          break;
        case 'FAILED':
          bucket.failed += 1;
          break;
        case 'REPLY':
          bucket.replies += 1;
          bucket.uniqueRepliedLeads += 1;
          break;
        case 'UNSUBSCRIBE':
          bucket.unsubscribes += 1;
          break;
        case 'COMPLAINT':
          bucket.complaints += 1;
          bucket.complaintDataAvailable = true;
          break;
      }
    }

    for (const bucket of buckets.values()) {
      bucket.attempted = bucket.sent + bucket.bounced + bucket.failed;
      if (bucket.delivered === 0) bucket.delivered = bucket.sent;
    }
    return buckets;
  }

  async getCampaignRows(input: StatsWindow): Promise<CampaignAnalyticsRow[]> {
    const { workspaceId, range, filters } = input;
    const countersByCampaign = await countersService.getCountersByCampaign({
      workspaceId,
      from: range.from,
      to: range.to,
      mailboxId: filters?.mailboxId,
    });

    const campaignIds = filters?.campaignId
      ? [filters.campaignId].filter((id) => countersByCampaign.has(id))
      : [...countersByCampaign.keys()];
    if (campaignIds.length === 0) return [];

    const [campaigns, enrollments, positives, meetings] = await Promise.all([
      prisma.campaign.findMany({
        where: { workspaceId, id: { in: campaignIds } },
        select: { id: true, name: true, status: true },
      }),
      prisma.campaignLead.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ['campaignId'],
        where: {
          workspaceId,
          campaignId: { in: campaignIds },
          classification: { in: [...POSITIVE_CLASSIFICATIONS] },
          firstReplyAt: { gte: range.from, lte: range.to },
        },
        _count: { _all: true },
      }),
      prisma.leadOutcomeEvent.groupBy({
        by: ['campaignId'],
        where: {
          workspaceId,
          campaignId: { in: campaignIds },
          type: 'MEETING_BOOKED',
          occurredAt: { gte: range.from, lte: range.to },
        },
        _count: { _all: true },
      }),
    ]);

    const enrolledBy = new Map(enrollments.map((row) => [row.campaignId, row._count._all]));
    const positiveBy = new Map(positives.map((row) => [row.campaignId ?? '', row._count._all]));
    const meetingBy = new Map(meetings.map((row) => [row.campaignId ?? '', row._count._all]));

    return campaigns
      .map((campaign) => {
        const counters = countersByCampaign.get(campaign.id) ?? { ...EMPTY_COUNTERS };
        const positiveReplies = positiveBy.get(campaign.id) ?? 0;
        return {
          campaignId: campaign.id,
          name: campaign.name,
          status: campaign.status,
          enrolledLeads: enrolledBy.get(campaign.id) ?? 0,
          counters,
          rates: calculateRates(counters),
          positiveReplies,
          meetings: meetingBy.get(campaign.id) ?? 0,
          positiveReplyRate: sendRate(positiveReplies, counters.sent, 'emails sent'),
        };
      })
      .sort((a, b) => b.counters.sent - a.counters.sent);
  }

  async getCampaignDetail(input: StatsWindow, campaignId: string) {
    const { workspaceId, range } = input;
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true, name: true, status: true, launchedAt: true },
    });
    if (!campaign) return null;

    const scoped: StatsWindow = { ...input, filters: { ...input.filters, campaignId } };
    const [rows, timeline, steps, replies, funnel, sequenceLifecycle] = await Promise.all([
      this.getCampaignRows(scoped),
      this.getTimeline(scoped),
      this.getSequenceRows(input, campaignId),
      this.getReplyAnalytics(scoped),
      funnelService.getFunnel({
        workspaceId,
        from: range.from,
        to: range.to,
        filters: { campaignId },
      }),
      this.getSequenceLifecycleStats(workspaceId, campaignId),
    ]);

    return { campaign, summary: rows[0] ?? null, timeline, steps, replies, funnel, sequenceLifecycle };
  }

  async getSequenceLifecycleStats(workspaceId: string, campaignId: string) {
    const enrollments = await prisma.campaignLead.findMany({
      where: { campaignId, campaign: { workspaceId } },
      select: { status: true, stopReason: true },
    });

    const total = enrollments.length;
    const active = enrollments.filter((e) => e.status === 'ACTIVE' || e.status === 'PENDING').length;
    const completed = enrollments.filter(
      (e) => e.status === 'COMPLETED' || e.stopReason === 'COMPLETED',
    ).length;
    const stoppedByReply = enrollments.filter((e) =>
      ['REPLIED', 'POSITIVE_REPLY', 'NEGATIVE_REPLY'].includes(e.stopReason ?? ''),
    ).length;
    const stoppedByUnsubscribe = enrollments.filter((e) => e.stopReason === 'UNSUBSCRIBED').length;
    const stoppedByBounce = enrollments.filter((e) =>
      ['BOUNCED', 'HARD_BOUNCED'].includes(e.stopReason ?? ''),
    ).length;

    return {
      total,
      active,
      completed,
      stoppedByReply,
      stoppedByUnsubscribe,
      stoppedByBounce,
      completionRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
    };
  }

  /**
   * Per-step performance.
   *
   * Sends and failures come straight from `SendingJob`, which records the step
   * that produced them. Replies carry no step reference, so each reply is
   * attributed to the most recent step sent to that lead before the reply
   * landed — the only defensible attribution available without open tracking.
   */
  async getSequenceRows(input: StatsWindow, campaignId?: string): Promise<SequenceStepRow[]> {
    const { workspaceId, range } = input;
    const targetCampaignId = campaignId ?? input.filters?.campaignId;

    const jobWhere: Prisma.SendingJobWhereInput = {
      workspaceId,
      ...(targetCampaignId ? { campaignId: targetCampaignId } : {}),
    };

    const [sentRows, failedRows, attribution] = await Promise.all([
      prisma.sendingJob.groupBy({
        by: ['sequenceStepId'],
        where: { ...jobWhere, status: 'SENT', sentAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
      prisma.sendingJob.groupBy({
        by: ['sequenceStepId'],
        where: { ...jobWhere, status: 'FAILED', failedAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
      }),
      this.attributeReplies(input, targetCampaignId),
    ]);

    const stepIds = new Set<string>([
      ...sentRows.map((row) => row.sequenceStepId),
      ...failedRows.map((row) => row.sequenceStepId),
      ...attribution.byStep.keys(),
    ]);
    if (stepIds.size === 0) return [];

    const steps = await prisma.campaignStep.findMany({
      where: {
        id: { in: [...stepIds] },
        campaign: { workspaceId, ...(targetCampaignId ? { id: targetCampaignId } : {}) },
      },
      select: {
        id: true,
        order: true,
        subjectTemplate: true,
        campaignId: true,
        campaign: { select: { name: true } },
      },
      orderBy: [{ campaignId: 'asc' }, { order: 'asc' }],
    });

    const sentBy = new Map(sentRows.map((row) => [row.sequenceStepId, row._count._all]));
    const failedBy = new Map(failedRows.map((row) => [row.sequenceStepId, row._count._all]));

    return steps.map((step) => {
      const attributed = attribution.byStep.get(step.id);
      const sent = sentBy.get(step.id) ?? 0;
      const failed = failedBy.get(step.id) ?? 0;
      const counters: DeliveryCounters = {
        ...EMPTY_COUNTERS,
        attempted: sent + failed,
        sent,
        delivered: sent,
        failed,
        replies: attributed?.replies ?? 0,
        uniqueRepliedLeads: attributed?.replies ?? 0,
        unsubscribes: attributed?.unsubscribes ?? 0,
      };
      return {
        stepId: step.id,
        campaignId: step.campaignId,
        campaignName: step.campaign.name,
        order: step.order,
        subject: step.subjectTemplate,
        counters,
        rates: calculateRates(counters),
      };
    });
  }

  async getSubjectRows(input: StatsWindow): Promise<SubjectRow[]> {
    const { workspaceId, range, filters } = input;
    const sentRows = await prisma.emailMessage.groupBy({
      by: ['renderedSubject'],
      where: {
        workspaceId,
        status: 'SENT',
        sentAt: { gte: range.from, lte: range.to },
        renderedSubject: { not: null },
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
      },
      _count: { _all: true },
    });
    if (sentRows.length === 0) return [];

    const attribution = await this.attributeReplies(input, filters?.campaignId);

    return sentRows
      .map((row) => {
        const subject = row.renderedSubject ?? '';
        const replies = attribution.bySubject.get(subject) ?? 0;
        return {
          subject,
          sent: row._count._all,
          replies,
          replyRate: sendRate(replies, row._count._all, 'emails sent'),
        };
      })
      .sort((a, b) => b.sent - a.sent);
  }

  async getMailboxRows(input: StatsWindow): Promise<MailboxAnalyticsRow[]> {
    const { workspaceId, range, filters } = input;
    const [mailboxes, countersByMailbox] = await Promise.all([
      prisma.mailbox.findMany({
        where: { workspaceId, ...(filters?.mailboxId ? { id: filters.mailboxId } : {}) },
        select: {
          id: true,
          emailAddress: true,
          health: { select: { score: true } },
          poolMemberships: { select: { pool: { select: { name: true } } } },
        },
        orderBy: { emailAddress: 'asc' },
      }),
      countersService.getCountersByMailbox({
        workspaceId,
        from: range.from,
        to: range.to,
        campaignId: filters?.campaignId,
      }),
    ]);

    return mailboxes
      .map((mailbox) => {
        const counters = countersByMailbox.get(mailbox.id) ?? { ...EMPTY_COUNTERS };
        return {
          mailboxId: mailbox.id,
          emailAddress: mailbox.emailAddress,
          poolNames: mailbox.poolMemberships.map((member) => member.pool.name),
          healthScore: mailbox.health?.score ?? 100,
          counters,
          rates: calculateRates(counters),
        };
      })
      .sort((a, b) => b.counters.sent - a.counters.sent);
  }

  async getSmtpPoolRows(input: StatsWindow): Promise<SmtpPoolRow[]> {
    const { workspaceId, range } = input;
    const [pools, countersByMailbox] = await Promise.all([
      prisma.smtpPool.findMany({
        where: { workspaceId },
        select: { id: true, name: true, members: { select: { mailboxId: true } } },
        orderBy: { name: 'asc' },
      }),
      countersService.getCountersByMailbox({ workspaceId, from: range.from, to: range.to }),
    ]);

    return pools.map((pool) => {
      const counters = sumCounters(
        pool.members.map((member) => countersByMailbox.get(member.mailboxId) ?? EMPTY_COUNTERS),
      );
      return {
        poolId: pool.id,
        name: pool.name,
        mailboxCount: pool.members.length,
        counters,
        rates: calculateRates(counters),
      };
    });
  }

  async getReplyAnalytics(input: StatsWindow): Promise<ReplyAnalytics> {
    const { workspaceId, range, filters } = input;
    const conversationWhere: Prisma.ConversationWhereInput = {
      workspaceId,
      firstReplyAt: { gte: range.from, lte: range.to },
      ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
    };

    const [counters, classificationRows, contactedLeads, responseTime] = await Promise.all([
      countersService.getCounters({
        workspaceId,
        from: range.from,
        to: range.to,
        campaignId: filters?.campaignId,
        mailboxId: filters?.mailboxId,
      }),
      prisma.conversation.groupBy({
        by: ['classification'],
        where: conversationWhere,
        _count: { _all: true },
      }),
      this.countContactedLeads(input),
      this.getResponseTime(input),
    ]);

    const breakdown = classificationRows
      .map((row) => ({
        classification: row.classification ?? ('UNCLASSIFIED' as const),
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const sumOf = (keys: readonly string[]): number =>
      breakdown
        .filter((row) => keys.includes(row.classification))
        .reduce((total, row) => total + row.count, 0);

    const positive = sumOf(POSITIVE_CLASSIFICATIONS);
    const uniqueRepliedLeads = counters.uniqueRepliedLeads;

    return {
      totalReplies: counters.replies,
      uniqueRepliedLeads,
      breakdown,
      positive,
      negative: sumOf(NEGATIVE_CLASSIFICATIONS),
      outOfOffice: sumOf(['OUT_OF_OFFICE']),
      unsubscribes: counters.unsubscribes,
      positiveRateOfReplies: leadRate(positive, uniqueRepliedLeads, 'leads that replied'),
      positiveRateOfContacted: leadRate(positive, contactedLeads, 'contacted leads'),
      responseTime,
    };
  }

  /// Hours between a lead's first send and its first reply.
  async getResponseTime(input: StatsWindow) {
    const { workspaceId, range, filters } = input;
    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId,
        firstReplyAt: { gte: range.from, lte: range.to },
        leadId: { not: null },
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
      },
      select: { leadId: true, firstReplyAt: true },
      take: MAX_ATTRIBUTED_REPLIES,
    });

    const leadIds = [...new Set(conversations.map((row) => row.leadId!).filter(Boolean))];
    if (leadIds.length === 0) {
      return { averageHours: null, medianHours: null, sampleSize: 0 };
    }

    const firstSends = await prisma.emailMessage.groupBy({
      by: ['leadId'],
      where: { workspaceId, leadId: { in: leadIds }, sentAt: { not: null } },
      _min: { sentAt: true },
    });
    const firstSentBy = new Map(
      firstSends.map((row) => [row.leadId ?? '', row._min.sentAt ?? null]),
    );

    const hours: number[] = [];
    for (const conversation of conversations) {
      const sentAt = firstSentBy.get(conversation.leadId ?? '');
      if (!sentAt || !conversation.firstReplyAt) continue;
      const delta = conversation.firstReplyAt.getTime() - sentAt.getTime();
      if (delta <= 0) continue;
      hours.push(delta / 3_600_000);
    }

    return {
      averageHours: average(hours),
      medianHours: median(hours),
      sampleSize: hours.length,
    };
  }

  async getMeetingAnalytics(input: StatsWindow): Promise<MeetingAnalytics> {
    const { workspaceId, range, filters } = input;
    const where: Prisma.LeadOutcomeEventWhereInput = {
      workspaceId,
      type: 'MEETING_BOOKED',
      occurredAt: { gte: range.from, lte: range.to },
      ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
    };

    const [booked, bySource, replies, contactedLeads] = await Promise.all([
      prisma.leadOutcomeEvent.count({ where }),
      prisma.leadOutcomeEvent.groupBy({ by: ['source'], where, _count: { _all: true } }),
      prisma.conversation.count({
        where: {
          workspaceId,
          classification: { in: [...POSITIVE_CLASSIFICATIONS] },
          firstReplyAt: { gte: range.from, lte: range.to },
          ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        },
      }),
      this.countContactedLeads(input),
    ]);

    return {
      booked,
      bySource: bySource.map((row) => ({ source: row.source, count: row._count._all })),
      meetingRateOfPositiveReplies: leadRate(booked, replies, 'positive replies'),
      meetingRateOfContacted: leadRate(booked, contactedLeads, 'contacted leads'),
      manualEntryOnly: true,
    };
  }

  async getLeadAnalytics(input: StatsWindow): Promise<VerificationAnalytics> {
    const { workspaceId, range, filters } = input;
    const leadWindow: LeadWindow = { workspaceId, from: range.from, to: range.to, filters };
    const [breakdown, total] = await Promise.all([
      analyticsCountersService.getVerificationBreakdown(leadWindow),
      prisma.lead.count({ where: { workspaceId, createdAt: { gte: range.from, lte: range.to } } }),
    ]);

    return {
      total,
      ...breakdown,
      verificationRate: leadRate(breakdown.verified, total, 'imported leads'),
    };
  }

  async getDimensionRows(
    input: StatsWindow,
    field: 'source' | 'industry' | 'country' | 'jobTitle',
  ): Promise<DimensionRow[]> {
    const { workspaceId, range, filters } = input;
    const grouped = await analyticsCountersService.groupByDimension(
      { workspaceId, from: range.from, to: range.to, filters },
      field,
    );

    return [...grouped.entries()]
      .map(([key, counts]) => ({
        key,
        label: key,
        leads: counts.leads,
        contacted: counts.contacted,
        replies: counts.replies,
        positiveReplies: counts.positiveReplies,
        meetings: counts.meetings,
        replyRate: leadRate(counts.replies, counts.contacted, 'contacted leads'),
        positiveReplyRate: leadRate(counts.positiveReplies, counts.contacted, 'contacted leads'),
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  /**
   * Company size cohorts, read from the enrichment payload.
   *
   * `companyProfile` is provider-shaped JSON, so sizes are bucketed only where
   * a numeric employee count is present. Leads without one are reported as
   * unknown rather than being spread across buckets.
   */
  async getCompanySizeRows(input: StatsWindow): Promise<DimensionRow[]> {
    const { workspaceId, range } = input;
    const enrichments = await prisma.leadEnrichment.findMany({
      where: {
        workspaceId,
        lead: { workspaceId, createdAt: { gte: range.from, lte: range.to } },
        companyProfile: { not: Prisma.DbNull },
      },
      select: {
        companyProfile: true,
        lead: {
          select: {
            status: true,
            conversations: { select: { classification: true, firstReplyAt: true } },
            outcomeEvents: { select: { type: true } },
          },
        },
      },
      take: 5_000,
    });

    const buckets = new Map<string, DimensionRow>();
    const bucketFor = (label: string): DimensionRow => {
      const existing = buckets.get(label);
      if (existing) return existing;
      const created: DimensionRow = {
        key: label,
        label,
        leads: 0,
        contacted: 0,
        replies: 0,
        positiveReplies: 0,
        meetings: 0,
        replyRate: leadRate(0, 0, 'contacted leads'),
        positiveReplyRate: leadRate(0, 0, 'contacted leads'),
      };
      buckets.set(label, created);
      return created;
    };

    for (const enrichment of enrichments) {
      const bucket = bucketFor(companySizeBucket(enrichment.companyProfile));
      bucket.leads += 1;
      if (['CONTACTED', 'REPLIED', 'CONVERTED'].includes(enrichment.lead.status)) {
        bucket.contacted += 1;
      }
      const conversations = enrichment.lead.conversations;
      if (conversations.some((row) => row.firstReplyAt)) bucket.replies += 1;
      const positiveSet: readonly string[] = POSITIVE_CLASSIFICATIONS;
      if (conversations.some((row) => row.classification && positiveSet.includes(row.classification))) {
        bucket.positiveReplies += 1;
      }
      if (enrichment.lead.outcomeEvents.some((row) => row.type === 'MEETING_BOOKED')) {
        bucket.meetings += 1;
      }
    }

    return [...buckets.values()]
      .map((row) => ({
        ...row,
        replyRate: leadRate(row.replies, row.contacted, 'contacted leads'),
        positiveReplyRate: leadRate(row.positiveReplies, row.contacted, 'contacted leads'),
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  async getWebsiteIntelligence(input: StatsWindow): Promise<WebsiteIntelligenceAnalytics> {
    const { workspaceId, range } = input;
    const where: Prisma.WebsiteAnalysisWhereInput = {
      workspaceId,
      status: 'COMPLETED',
      createdAt: { gte: range.from, lte: range.to },
    };

    const [analyzed, byPriority, averages, scored] = await Promise.all([
      prisma.websiteAnalysis.count({ where }),
      prisma.websiteAnalysis.groupBy({
        by: ['opportunityPriority'],
        where,
        _count: { _all: true },
      }),
      prisma.websiteAnalysis.aggregate({
        where,
        _avg: { websiteScore: true, opportunityScore: true },
      }),
      prisma.websiteAnalysis.findMany({
        where: { ...where, websiteScore: { not: null } },
        select: { websiteScore: true },
        take: 20_000,
      }),
    ]);

    const bucketCounts = new Map<string, number>();
    for (const row of scored) {
      const bucket = scoreBucket(row.websiteScore!);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }

    return {
      analyzed,
      byPriority: byPriority.map((row) => ({
        priority: row.opportunityPriority ?? 'UNKNOWN',
        count: row._count._all,
      })),
      byScoreBucket: [...bucketCounts.entries()]
        .map(([bucket, count]) => ({ bucket, count }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket)),
      averageWebsiteScore: roundOrNull(averages._avg.websiteScore),
      averageOpportunityScore: roundOrNull(averages._avg.opportunityScore),
    };
  }

  async getImportAnalytics(input: StatsWindow): Promise<ImportAnalytics> {
    const { workspaceId, range } = input;
    const where: Prisma.LeadImportWhereInput = {
      workspaceId,
      createdAt: { gte: range.from, lte: range.to },
    };

    const [totals, bySource] = await Promise.all([
      prisma.leadImport.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          totalRows: true,
          importedCount: true,
          skippedCount: true,
          duplicateCount: true,
          errorCount: true,
        },
      }),
      prisma.leadImport.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
        _sum: { importedCount: true },
      }),
    ]);

    return {
      totalImports: totals._count._all,
      totalRows: totals._sum.totalRows ?? 0,
      imported: totals._sum.importedCount ?? 0,
      skipped: totals._sum.skippedCount ?? 0,
      duplicates: totals._sum.duplicateCount ?? 0,
      errors: totals._sum.errorCount ?? 0,
      bySource: bySource.map((row) => ({
        source: row.source,
        imports: row._count._all,
        imported: row._sum.importedCount ?? 0,
      })),
      coverageNote:
        'Covers Google Drive and batch imports. CSV uploads are processed inline and are not recorded here.',
    };
  }

  async getDiscoveryAnalytics(input: StatsWindow): Promise<DiscoveryAnalytics> {
    const { workspaceId, range } = input;
    const where: Prisma.LeadDiscoveryJobWhereInput = {
      workspaceId,
      createdAt: { gte: range.from, lte: range.to },
    };

    const [totals, byStatus, bySource] = await Promise.all([
      prisma.leadDiscoveryJob.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          discoveredCount: true,
          uniqueCount: true,
          duplicateCount: true,
          promotedCount: true,
          qualifiedCount: true,
          enrichedCount: true,
          emailsFoundCount: true,
          emailsVerifiedCount: true,
        },
      }),
      prisma.leadDiscoveryJob.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.leadDiscoveryJob.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
        _sum: {
          discoveredCount: true,
          promotedCount: true,
          qualifiedCount: true,
        },
      }),
    ]);

    const statusCount = (status: string) =>
      byStatus.find((r) => r.status === status)?._count._all ?? 0;

    return {
      totalJobs: totals._count._all,
      completed: statusCount('COMPLETED'),
      failed: statusCount('FAILED'),
      cancelled: statusCount('CANCELLED'),
      partial: statusCount('PARTIAL'),
      running: statusCount('RUNNING'),
      businessesDiscovered: totals._sum.discoveredCount ?? 0,
      uniqueLeads: totals._sum.uniqueCount ?? 0,
      duplicatesRemoved: totals._sum.duplicateCount ?? 0,
      leadsPromoted: totals._sum.promotedCount ?? 0,
      leadsQualified: totals._sum.qualifiedCount ?? 0,
      enriched: totals._sum.enrichedCount ?? 0,
      emailsFound: totals._sum.emailsFoundCount ?? 0,
      emailsVerified: totals._sum.emailsVerifiedCount ?? 0,
      bySource: bySource.map((row) => ({
        source: row.source,
        jobs: row._count._all,
        discovered: row._sum.discoveredCount ?? 0,
        promoted: row._sum.promotedCount ?? 0,
        qualified: row._sum.qualifiedCount ?? 0,
      })),
    };
  }

  /// Warmup traffic only. These sends never appear in campaign metrics because
  /// campaign counters are derived from delivery events, which warmup does not emit.
  async getWarmupAnalytics(input: StatsWindow): Promise<WarmupAnalytics> {
    const { workspaceId, range } = input;
    const rows = await prisma.warmupDailyHistory.findMany({
      where: {
        workspaceId,
        usageDate: { gte: startOfUtcDay(range.from), lte: range.to },
      },
      orderBy: { usageDate: 'asc' },
    });

    const daily = new Map<string, { sent: number; failed: number }>();
    const mailboxes = new Set<string>();
    let scheduled = 0;
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    let deferred = 0;

    for (const row of rows) {
      scheduled += row.scheduledCount;
      attempted += row.attemptedCount;
      sent += row.sentCount;
      failed += row.failedCount;
      deferred += row.deferredCount;
      if (row.sentCount > 0) mailboxes.add(row.mailboxId);

      const key = toDateKey(row.usageDate);
      const bucket = daily.get(key) ?? { sent: 0, failed: 0 };
      bucket.sent += row.sentCount;
      bucket.failed += row.failedCount;
      daily.set(key, bucket);
    }

    return {
      scheduled,
      attempted,
      sent,
      failed,
      deferred,
      mailboxesWarming: mailboxes.size,
      daily: [...daily.entries()].map(([date, value]) => ({ date, ...value })),
    };
  }

  async getDailyActivity(workspaceId: string, day = new Date()): Promise<DailyActivity> {
    const from = startOfUtcDay(day);
    const to = new Date(from.getTime() + 86_399_999);

    const [counters, newLeads, meetings, scheduledSends] = await Promise.all([
      countersService.getCounters({ workspaceId, from, to }),
      prisma.lead.count({ where: { workspaceId, createdAt: { gte: from, lte: to } } }),
      prisma.leadOutcomeEvent.count({
        where: { workspaceId, type: 'MEETING_BOOKED', occurredAt: { gte: from, lte: to } },
      }),
      prisma.sendingJob.count({
        where: {
          workspaceId,
          status: { in: ['PENDING', 'SCHEDULED'] },
          scheduledAt: { gte: from, lte: to },
        },
      }),
    ]);

    return {
      date: toDateKey(from),
      sent: counters.sent,
      delivered: counters.delivered,
      bounced: counters.bounced,
      failed: counters.failed,
      replies: counters.replies,
      newLeads,
      meetings,
      scheduledSends,
    };
  }

  async getTopPerformers(input: StatsWindow) {
    const [campaigns, sources, industries, mailboxes] = await Promise.all([
      this.getCampaignRows(input),
      this.getDimensionRows(input, 'source'),
      this.getDimensionRows(input, 'industry'),
      this.getMailboxRows(input),
    ]);

    const byReplyRate = <T extends { rates: { replyRate: number } }>(rows: T[]): T[] =>
      [...rows].sort((a, b) => b.rates.replyRate - a.rates.replyRate).slice(0, 5);

    const byPositiveRate = (rows: DimensionRow[]): DimensionRow[] =>
      [...rows]
        .filter((row) => row.positiveReplyRate.sufficientData)
        .sort((a, b) => (b.positiveReplyRate.value ?? 0) - (a.positiveReplyRate.value ?? 0))
        .slice(0, 5);

    return {
      campaigns: byReplyRate(campaigns),
      mailboxes: byReplyRate(mailboxes),
      sources: byPositiveRate(sources),
      industries: byPositiveRate(industries),
    };
  }

  /// Distinct leads that received at least one send in the range. Used as the
  /// denominator whenever a rate is expressed "per contacted lead".
  private async countContactedLeads(input: StatsWindow): Promise<number> {
    const { workspaceId, range, filters } = input;
    const rows = await prisma.emailDeliveryEvent.findMany({
      where: {
        workspaceId,
        eventType: 'SENT',
        occurredAt: { gte: range.from, lte: range.to },
        leadId: { not: null },
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
      },
      distinct: ['leadId'],
      select: { leadId: true },
    });
    return rows.length;
  }

  /**
   * Maps each reply in the range onto the step and subject that most likely
   * triggered it: the latest send to that lead before the reply arrived.
   */
  private async attributeReplies(
    input: StatsWindow,
    campaignId?: string,
  ): Promise<{ byStep: Map<string, { replies: number; unsubscribes: number }>; bySubject: Map<string, number> }> {
    const { workspaceId, range, filters } = input;
    const byStep = new Map<string, { replies: number; unsubscribes: number }>();
    const bySubject = new Map<string, number>();

    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId,
        firstReplyAt: { gte: range.from, lte: range.to },
        leadId: { not: null },
        ...(campaignId ? { campaignId } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
      },
      select: { leadId: true, firstReplyAt: true, classification: true },
      take: MAX_ATTRIBUTED_REPLIES,
    });
    if (conversations.length === 0) return { byStep, bySubject };

    const leadIds = [...new Set(conversations.map((row) => row.leadId!))];
    const jobs = await prisma.sendingJob.findMany({
      where: {
        workspaceId,
        leadId: { in: leadIds },
        status: 'SENT',
        sentAt: { not: null },
        ...(campaignId ? { campaignId } : {}),
      },
      select: { leadId: true, sentAt: true, sequenceStepId: true, emailMessageId: true },
      orderBy: { sentAt: 'asc' },
    });

    const messageIds = jobs.map((job) => job.emailMessageId).filter((id): id is string => !!id);
    const messages =
      messageIds.length > 0
        ? await prisma.emailMessage.findMany({
            where: { workspaceId, id: { in: messageIds } },
            select: { id: true, renderedSubject: true },
          })
        : [];
    const subjectByMessage = new Map(messages.map((row) => [row.id, row.renderedSubject]));

    const jobsByLead = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const list = jobsByLead.get(job.leadId) ?? [];
      list.push(job);
      jobsByLead.set(job.leadId, list);
    }

    for (const conversation of conversations) {
      const candidates = jobsByLead.get(conversation.leadId!) ?? [];
      let match: (typeof jobs)[number] | undefined;
      for (const job of candidates) {
        if (job.sentAt && conversation.firstReplyAt && job.sentAt <= conversation.firstReplyAt) {
          match = job;
        }
      }
      if (!match) continue;

      const bucket = byStep.get(match.sequenceStepId) ?? { replies: 0, unsubscribes: 0 };
      bucket.replies += 1;
      if (conversation.classification === 'UNSUBSCRIBE') bucket.unsubscribes += 1;
      byStep.set(match.sequenceStepId, bucket);

      const subject = match.emailMessageId
        ? subjectByMessage.get(match.emailMessageId)
        : undefined;
      if (subject) bySubject.set(subject, (bySubject.get(subject) ?? 0) + 1);
    }

    return { byStep, bySubject };
  }
}

function kpi(key: string, label: string, value: number, previous: number): KpiCard {
  return { key, label, value, trend: buildTrend(value, previous) };
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function scoreBucket(score: number): string {
  if (score >= 80) return '80-100';
  if (score >= 60) return '60-79';
  if (score >= 40) return '40-59';
  if (score >= 20) return '20-39';
  return '0-19';
}

/// Reads an employee count out of provider-shaped enrichment JSON. Anything we
/// cannot read confidently is bucketed as Unknown instead of being guessed.
export function companySizeBucket(profile: Prisma.JsonValue | null): string {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return 'Unknown';
  const record = profile as Record<string, unknown>;
  const raw = record.employeeCount ?? record.employees ?? record.size ?? record.headcount;

  const count = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(count) || count <= 0) {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : 'Unknown';
  }

  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  if (count <= 1000) return '201-1000';
  return '1000+';
}

export const analyticsStatsService = new AnalyticsStatsService();
export { buildFunnel };
