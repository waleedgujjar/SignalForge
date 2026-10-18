import { beforeEach, describe, expect, it, vi } from 'vitest';

const aggregate = vi.fn();
const groupBy = vi.fn();

vi.mock('@signalforge/database', () => ({
  Prisma: {},
  prisma: {
    leadDiscoveryJob: { aggregate, groupBy },
    lead: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    leadVerification: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    leadOutcomeEvent: { count: vi.fn().mockResolvedValue(0) },
    emailDeliveryEvent: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    leadImport: { aggregate: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    warmupDailyHistory: { findMany: vi.fn().mockResolvedValue([]) },
    campaign: { findMany: vi.fn().mockResolvedValue([]) },
    campaignLead: { groupBy: vi.fn().mockResolvedValue([]) },
    sequenceStep: { findMany: vi.fn().mockResolvedValue([]) },
    sendingJob: { count: vi.fn().mockResolvedValue(0) },
    mailbox: { findMany: vi.fn().mockResolvedValue([]) },
    smtpPool: { findMany: vi.fn().mockResolvedValue([]) },
    websiteIntelligenceResult: {
      aggregate: vi.fn().mockResolvedValue({ _avg: {} }),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    workspaceAnalyticsSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@signalforge/deliverability', () => ({
  EMPTY_COUNTERS: {
    sent: 0, delivered: 0, bounced: 0, failed: 0, complaints: 0,
    replies: 0, uniqueRepliedLeads: 0, unsubscribes: 0,
  },
  calculateRates: vi.fn(() => ({
    deliveryRate: 0, bounceRate: 0, replyRate: 0, unsubscribeRate: 0, complaintRate: 0,
  })),
  countersService: {
    getCounters: vi.fn().mockResolvedValue({
      sent: 0, delivered: 0, bounced: 0, failed: 0, complaints: 0,
      replies: 0, uniqueRepliedLeads: 0, unsubscribes: 0,
    }),
  },
  sumCounters: vi.fn(() => ({
    sent: 0, delivered: 0, bounced: 0, failed: 0, complaints: 0,
    replies: 0, uniqueRepliedLeads: 0, unsubscribes: 0,
  })),
}));

const { analyticsStatsService } = await import('./stats-service.js');

const window = {
  workspaceId: 'ws-1',
  range: {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-30T23:59:59.999Z'),
    period: '30d' as const,
    days: 30,
  },
};

beforeEach(() => {
  aggregate.mockReset();
  groupBy.mockReset();
});

describe('getDiscoveryAnalytics', () => {
  it('aggregates counters from discovery jobs', async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _sum: {
        discoveredCount: 200,
        uniqueCount: 180,
        duplicateCount: 20,
        promotedCount: 150,
        qualifiedCount: 80,
        enrichedCount: 60,
        emailsFoundCount: 120,
        emailsVerifiedCount: 100,
      },
    });
    groupBy
      .mockResolvedValueOnce([
        { status: 'COMPLETED', _count: { _all: 3 } },
        { status: 'FAILED', _count: { _all: 1 } },
        { status: 'PARTIAL', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { source: 'GOOGLE_MAPS', _count: { _all: 4 }, _sum: { discoveredCount: 180, promotedCount: 130, qualifiedCount: 70 } },
        { source: 'CSV_UPLOAD', _count: { _all: 1 }, _sum: { discoveredCount: 20, promotedCount: 20, qualifiedCount: 10 } },
      ]);

    const result = await analyticsStatsService.getDiscoveryAnalytics(window);

    expect(result.totalJobs).toBe(5);
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.partial).toBe(1);
    expect(result.running).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(result.businessesDiscovered).toBe(200);
    expect(result.uniqueLeads).toBe(180);
    expect(result.duplicatesRemoved).toBe(20);
    expect(result.leadsPromoted).toBe(150);
    expect(result.leadsQualified).toBe(80);
    expect(result.enriched).toBe(60);
    expect(result.emailsFound).toBe(120);
    expect(result.emailsVerified).toBe(100);
    expect(result.bySource).toHaveLength(2);
    expect(result.bySource[0]).toEqual({
      source: 'GOOGLE_MAPS',
      jobs: 4,
      discovered: 180,
      promoted: 130,
      qualified: 70,
    });
  });

  it('scopes all queries to the workspace', async () => {
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} });
    groupBy.mockResolvedValue([]);

    await analyticsStatsService.getDiscoveryAnalytics(window);

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'ws-1' }),
      }),
    );
    for (const call of groupBy.mock.calls) {
      expect((call[0] as { where: { workspaceId: string } }).where.workspaceId).toBe('ws-1');
    }
  });

  it('returns all zeros for an empty dataset', async () => {
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} });
    groupBy.mockResolvedValue([]);

    const result = await analyticsStatsService.getDiscoveryAnalytics(window);

    expect(result.totalJobs).toBe(0);
    expect(result.businessesDiscovered).toBe(0);
    expect(result.uniqueLeads).toBe(0);
    expect(result.leadsPromoted).toBe(0);
    expect(result.emailsFound).toBe(0);
    expect(result.bySource).toEqual([]);
  });

  it('constrains queries to the date range', async () => {
    aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} });
    groupBy.mockResolvedValue([]);

    await analyticsStatsService.getDiscoveryAnalytics(window);

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: window.range.from, lte: window.range.to },
        }),
      }),
    );
  });
});
