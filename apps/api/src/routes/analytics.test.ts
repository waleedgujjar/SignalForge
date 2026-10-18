import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalyticsCountersService,
  OutcomeService,
} from '@signalforge/analytics';

let outcomeService: OutcomeService;
let countersService: AnalyticsCountersService;
let LeadOutcomeNotFoundError: new (message?: string) => Error;

interface LeadRow {
  id: string;
  workspaceId: string;
  status: string;
}

interface CampaignRow {
  id: string;
  workspaceId: string;
}

interface OutcomeRow {
  id: string;
  workspaceId: string;
  leadId: string;
  campaignId: string | null;
  type: string;
  source: string;
  occurredAt: Date;
}

const leads = new Map<string, LeadRow>();
const campaigns = new Map<string, CampaignRow>();
const outcomes = new Map<string, OutcomeRow>();
/// Every `where` clause the counters service sends to Prisma, so tests can
/// assert that workspace scoping is never omitted.
const leadCountWheres: Array<Record<string, unknown>> = [];

function matchesWorkspace(row: { workspaceId: string }, where: { workspaceId?: string }): boolean {
  return !where.workspaceId || row.workspaceId === where.workspaceId;
}

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
    AI_PROVIDER: 'mock',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-4o-mini',
    REDIS_URL: 'redis://localhost:6379',
  }),
}));

vi.mock('@signalforge/database', () => ({
  Prisma: { DbNull: Symbol('DbNull') },
  prisma: {
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = leads.get(where.id);
        return row && row.workspaceId === where.workspaceId ? row : null;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        leadCountWheres.push(where);
        return [...leads.values()].filter((row) =>
          matchesWorkspace(row, where as { workspaceId?: string }),
        ).length;
      }),
      groupBy: vi.fn(async () => []),
    },
    campaign: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = campaigns.get(where.id);
        return row && row.workspaceId === where.workspaceId ? row : null;
      }),
    },
    leadVerification: {
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    leadOutcomeEvent: {
      create: vi.fn(async ({ data }: { data: Omit<OutcomeRow, 'id'> }) => {
        const id = `outcome_${outcomes.size + 1}`;
        const row: OutcomeRow = { ...data, id };
        outcomes.set(id, row);
        return row;
      }),
      count: vi.fn(async ({ where }: { where: { workspaceId: string; type?: string } }) => {
        return [...outcomes.values()].filter(
          (row) => row.workspaceId === where.workspaceId && (!where.type || row.type === where.type),
        ).length;
      }),
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string; type?: string } }) => {
        return [...outcomes.values()].filter(
          (row) => row.workspaceId === where.workspaceId && (!where.type || row.type === where.type),
        );
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = outcomes.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return { count: 0 };
        outcomes.delete(where.id);
        return { count: 1 };
      }),
    },
  },
}));

beforeAll(async () => {
  const analytics = await import('@signalforge/analytics');
  outcomeService = analytics.outcomeService;
  countersService = analytics.analyticsCountersService;
  LeadOutcomeNotFoundError = analytics.LeadOutcomeNotFoundError;
}, 30_000);

beforeEach(() => {
  leads.clear();
  campaigns.clear();
  outcomes.clear();
  leadCountWheres.length = 0;

  leads.set('lead_ws1', { id: 'lead_ws1', workspaceId: 'ws_1', status: 'CONTACTED' });
  leads.set('lead_ws2', { id: 'lead_ws2', workspaceId: 'ws_2', status: 'NEW' });
  campaigns.set('camp_ws1', { id: 'camp_ws1', workspaceId: 'ws_1' });
  campaigns.set('camp_ws2', { id: 'camp_ws2', workspaceId: 'ws_2' });
});

describe('Lead outcome workspace isolation', () => {
  it('records a meeting against a lead in the caller workspace', async () => {
    const outcome = await outcomeService.record({
      workspaceId: 'ws_1',
      leadId: 'lead_ws1',
      type: 'MEETING_BOOKED',
    });

    expect(outcome.workspaceId).toBe('ws_1');
    expect(outcomes.size).toBe(1);
  });

  it('refuses to attach an outcome to another workspace lead', async () => {
    await expect(
      outcomeService.record({ workspaceId: 'ws_1', leadId: 'lead_ws2', type: 'MEETING_BOOKED' }),
    ).rejects.toBeInstanceOf(LeadOutcomeNotFoundError);
    expect(outcomes.size).toBe(0);
  });

  it('refuses to attribute an outcome to another workspace campaign', async () => {
    await expect(
      outcomeService.record({
        workspaceId: 'ws_1',
        leadId: 'lead_ws1',
        campaignId: 'camp_ws2',
        type: 'MEETING_BOOKED',
      }),
    ).rejects.toBeInstanceOf(LeadOutcomeNotFoundError);
    expect(outcomes.size).toBe(0);
  });

  it('lists only outcomes belonging to the caller workspace', async () => {
    await outcomeService.record({ workspaceId: 'ws_1', leadId: 'lead_ws1', type: 'MEETING_BOOKED' });
    await outcomeService.record({ workspaceId: 'ws_2', leadId: 'lead_ws2', type: 'MEETING_BOOKED' });

    const first = await outcomeService.list({ workspaceId: 'ws_1' });
    const second = await outcomeService.list({ workspaceId: 'ws_2' });

    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.workspaceId).toBe('ws_1');
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.workspaceId).toBe('ws_2');
  });

  it('refuses to delete an outcome owned by another workspace', async () => {
    const created = await outcomeService.record({
      workspaceId: 'ws_1',
      leadId: 'lead_ws1',
      type: 'MEETING_BOOKED',
    });

    await expect(outcomeService.delete('ws_2', created.id)).rejects.toBeInstanceOf(
      LeadOutcomeNotFoundError,
    );
    expect(outcomes.size).toBe(1);

    await outcomeService.delete('ws_1', created.id);
    expect(outcomes.size).toBe(0);
  });
});

describe('Analytics counters workspace isolation', () => {
  const range = { from: new Date('2026-03-01T00:00:00.000Z'), to: new Date('2026-03-31T23:59:59.999Z') };

  it('scopes every funnel query to the requested workspace', async () => {
    await countersService.getFunnelCounts({ workspaceId: 'ws_1', ...range });

    expect(leadCountWheres.length).toBeGreaterThan(0);
    for (const where of leadCountWheres) {
      expect(where.workspaceId).toBe('ws_1');
    }
  });

  it('counts only the leads owned by the requested workspace', async () => {
    const first = await countersService.getFunnelCounts({ workspaceId: 'ws_1', ...range });
    const second = await countersService.getFunnelCounts({ workspaceId: 'ws_2', ...range });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(1);
  });

  it('keeps the workspace filter when a campaign filter is applied', async () => {
    await countersService.getFunnelCounts({
      workspaceId: 'ws_1',
      ...range,
      filters: { campaignId: 'camp_ws1' },
    });

    for (const where of leadCountWheres) {
      expect(where.workspaceId).toBe('ws_1');
      expect(where.campaignLeads).toEqual({ some: { campaignId: 'camp_ws1' } });
    }
  });
});
