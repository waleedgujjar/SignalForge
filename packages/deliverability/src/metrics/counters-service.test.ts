import { beforeEach, describe, expect, it, vi } from 'vitest';

const groupBy = vi.fn();
const findMany = vi.fn();

vi.mock('@signalforge/database', () => ({
  prisma: { emailDeliveryEvent: { groupBy, findMany } },
}));

const { countersService } = await import('./counters-service.js');

const window = {
  workspaceId: 'workspace-1',
  from: new Date('2026-03-01T00:00:00.000Z'),
  to: new Date('2026-03-08T00:00:00.000Z'),
};

/** Every `where` clause passed to Prisma during the last call. */
function whereClauses(): Array<Record<string, unknown>> {
  return [...groupBy.mock.calls, ...findMany.mock.calls].map(
    (call) => (call[0] as { where: Record<string, unknown> }).where,
  );
}

beforeEach(() => {
  groupBy.mockReset().mockResolvedValue([]);
  findMany.mockReset().mockResolvedValue([]);
});

describe('CountersService workspace isolation', () => {
  it('scopes every workspace-level query by workspaceId', async () => {
    await countersService.getCounters(window);

    const clauses = whereClauses();
    expect(clauses.length).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(clause.workspaceId).toBe('workspace-1');
    }
  });

  it('scopes every mailbox comparison query by workspaceId', async () => {
    await countersService.getCountersByMailbox(window);

    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
    }
  });

  it('scopes every campaign comparison query by workspaceId', async () => {
    await countersService.getCountersByCampaign(window);

    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
    }
  });

  it('adds the mailbox filter on top of the workspace filter rather than replacing it', async () => {
    await countersService.getCounters({ ...window, mailboxId: 'mailbox-1' });

    for (const clause of whereClauses()) {
      expect(clause.workspaceId).toBe('workspace-1');
      expect(clause.mailboxId).toBe('mailbox-1');
    }
  });
});

describe('CountersService aggregation', () => {
  it('derives attempted sends from accepted, bounced, and failed events', async () => {
    groupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes('bounceType')) {
        return [
          { bounceType: 'HARD', _count: { _all: 3 } },
          { bounceType: 'SOFT', _count: { _all: 2 } },
        ];
      }
      return [
        { eventType: 'SENT', _count: { _all: 95 } },
        { eventType: 'BOUNCED', _count: { _all: 5 } },
        { eventType: 'FAILED', _count: { _all: 5 } },
        { eventType: 'REPLY', _count: { _all: 12 } },
        { eventType: 'UNSUBSCRIBE', _count: { _all: 1 } },
      ];
    });
    findMany.mockResolvedValue([{ leadId: 'lead-1' }, { leadId: 'lead-2' }]);

    const counters = await countersService.getCounters(window);

    expect(counters.attempted).toBe(105);
    expect(counters.hardBounces).toBe(3);
    expect(counters.softBounces).toBe(2);
    expect(counters.replies).toBe(12);
    expect(counters.uniqueRepliedLeads).toBe(2);
  });

  it('falls back to accepted sends when the provider reports no delivery events', async () => {
    groupBy.mockImplementation(async (args: { by: string[] }) =>
      args.by.includes('bounceType') ? [] : [{ eventType: 'SENT', _count: { _all: 10 } }],
    );

    const counters = await countersService.getCounters(window);
    expect(counters.delivered).toBe(10);
  });

  it('marks complaint data unavailable when no complaint events exist', async () => {
    const counters = await countersService.getCounters(window);
    expect(counters.complaintDataAvailable).toBe(false);
    expect(counters.complaints).toBe(0);
  });
});
