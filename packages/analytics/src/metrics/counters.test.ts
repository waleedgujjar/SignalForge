import { beforeEach, describe, expect, it, vi } from 'vitest';

const leadCount = vi.fn();
const leadGroupBy = vi.fn();
const verificationCount = vi.fn();
const verificationGroupBy = vi.fn();
const outcomeCount = vi.fn();

vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: { count: leadCount, groupBy: leadGroupBy },
    leadVerification: { count: verificationCount, groupBy: verificationGroupBy },
    leadOutcomeEvent: { count: outcomeCount },
  },
}));

const { analyticsCountersService } = await import('./counters.js');

const window = {
  workspaceId: 'workspace-1',
  from: new Date('2026-03-01T00:00:00.000Z'),
  to: new Date('2026-03-08T00:00:00.000Z'),
};

type WhereClause = Record<string, unknown>;

/// Every `where` clause Prisma received across the mocked models.
function whereClauses(): WhereClause[] {
  return [
    ...leadCount.mock.calls,
    ...leadGroupBy.mock.calls,
    ...verificationCount.mock.calls,
    ...verificationGroupBy.mock.calls,
    ...outcomeCount.mock.calls,
  ].map((call) => (call[0] as { where: WhereClause }).where);
}

beforeEach(() => {
  leadCount.mockReset().mockResolvedValue(0);
  leadGroupBy.mockReset().mockResolvedValue([]);
  verificationCount.mockReset().mockResolvedValue(0);
  verificationGroupBy.mockReset().mockResolvedValue([]);
  outcomeCount.mockReset().mockResolvedValue(0);
});

describe('AnalyticsCountersService workspace isolation', () => {
  it('scopes every funnel query to the requested workspace', async () => {
    await analyticsCountersService.getFunnelCounts(window);

    const clauses = whereClauses();
    expect(clauses).toHaveLength(7);
    for (const clause of clauses) {
      expect(clause.workspaceId).toBe('workspace-1');
    }
  });

  it('scopes activity counts to the workspace, including related-model queries', async () => {
    await analyticsCountersService.getActivityCounts(window);

    for (const clause of whereClauses()) {
      const scoped =
        clause.workspaceId === 'workspace-1' ||
        (clause.lead as WhereClause | undefined)?.workspaceId === 'workspace-1';
      expect(scoped).toBe(true);
    }
  });

  it('scopes dimensional grouping to the workspace', async () => {
    await analyticsCountersService.groupByDimension(window, 'industry');

    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
    }
  });

  it('scopes the verification breakdown through the lead relation', async () => {
    await analyticsCountersService.getVerificationBreakdown(window);

    for (const clause of whereClauses()) {
      expect((clause.lead as WhereClause).workspaceId).toBe('workspace-1');
    }
  });

  it('adds dimensional filters on top of the workspace filter rather than replacing it', async () => {
    await analyticsCountersService.getFunnelCounts({
      ...window,
      filters: { industry: 'SaaS', country: 'US' },
    });

    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
      expect(clause.industry).toBe('SaaS');
      expect(clause.country).toBe('US');
    }
  });

  it('constrains every query to the requested range', async () => {
    await analyticsCountersService.getFunnelCounts(window);

    for (const clause of whereClauses()) {
      expect(clause.createdAt).toEqual({ gte: window.from, lte: window.to });
    }
  });
});

describe('AnalyticsCountersService two-workspace isolation', () => {
  it('never returns data from another workspace', async () => {
    leadCount.mockImplementation(async (args: { where: { workspaceId: string } }) => {
      if (args.where.workspaceId === 'workspace-1') return 10;
      if (args.where.workspaceId === 'workspace-2') return 99;
      return 0;
    });
    leadGroupBy.mockResolvedValue([]);
    verificationCount.mockResolvedValue(0);
    verificationGroupBy.mockResolvedValue([]);
    outcomeCount.mockResolvedValue(0);

    const counts = await analyticsCountersService.getFunnelCounts(window);

    expect(counts.imported).toBe(10);
    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
      expect(clause.workspaceId).not.toBe('workspace-2');
    }
  });
});

describe('AnalyticsCountersService aggregation', () => {
  it('merges the per-stage groupings into one row per dimension value', async () => {
    leadGroupBy
      .mockResolvedValueOnce([
        { industry: 'SaaS', _count: { _all: 40 } },
        { industry: null, _count: { _all: 10 } },
      ])
      .mockResolvedValueOnce([{ industry: 'SaaS', _count: { _all: 25 } }])
      .mockResolvedValueOnce([{ industry: 'SaaS', _count: { _all: 8 } }])
      .mockResolvedValueOnce([{ industry: 'SaaS', _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ industry: 'SaaS', _count: { _all: 1 } }]);

    const result = await analyticsCountersService.groupByDimension(window, 'industry');

    expect(result.get('SaaS')).toEqual({
      leads: 40,
      contacted: 25,
      replies: 8,
      positiveReplies: 3,
      meetings: 1,
    });
    expect(result.get('Unknown')?.leads).toBe(10);
  });

  it('reports zero for verification statuses that never occurred', async () => {
    verificationGroupBy.mockResolvedValue([{ status: 'VERIFIED', _count: { _all: 12 } }]);

    const breakdown = await analyticsCountersService.getVerificationBreakdown(window);

    expect(breakdown).toEqual({
      verified: 12,
      invalid: 0,
      risky: 0,
      unknown: 0,
      disposable: 0,
      roleBased: 0,
    });
  });
});
