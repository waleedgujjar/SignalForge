import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

interface WarmupJobRow {
  id: string;
  mailboxId: string;
  usageDate: Date;
  slotIndex: number;
  scheduledAt: Date;
  status: string;
  workspaceId: string;
  configId: string;
}

interface ConfigRow {
  id: string;
  workspaceId: string;
  mailboxId: string;
  enabled: boolean;
  status: string;
  currentDailyLimit: number;
  maximumDailyLimit: number;
  startingDailyLimit: number;
  rampStep: number;
  rampIntervalHours: number;
  timezone: string;
  weekdays: number[];
  windowStart: string;
  windowEnd: string;
  startDate: Date;
  lastProgressionAt: Date | null;
  mailbox: {
    id: string;
    workspaceId: string;
    emailAddress: string;
    fromName: string;
    timezone: string | null;
    healthStatus: string;
    workspace: { timezone: string };
  };
}

const warmupJobs: WarmupJobRow[] = [];
const configRows: ConfigRow[] = [];
const historyRows = new Map<string, { scheduledCount: number }>();
const enqueuedPayloads: unknown[] = [];

vi.mock('@signalforge/database', () => ({
  prisma: {
    emailWarmupConfig: {
      findMany: async ({
        where: _where,
      }: {
        where: { enabled: boolean; status: string };
        include?: unknown;
      }) => {
        return configRows.filter((c) => c.enabled && c.status === 'ACTIVE');
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ConfigRow> }) => {
        const found = configRows.find((c) => c.id === where.id);
        if (!found) throw new Error('config not found');
        Object.assign(found, data);
        return found;
      },
    },
    warmupJob: {
      findMany: async ({ where }: { where: { mailboxId: string; usageDate: Date } }) => {
        return warmupJobs.filter(
          (j) =>
            j.mailboxId === where.mailboxId &&
            j.usageDate.getTime() === where.usageDate.getTime(),
        );
      },
      create: async ({ data }: { data: Omit<WarmupJobRow, 'id'> }) => {
        const exists = warmupJobs.some(
          (j) =>
            j.mailboxId === data.mailboxId &&
            j.usageDate.getTime() === data.usageDate.getTime() &&
            j.slotIndex === data.slotIndex,
        );
        if (exists) {
          const err = new Error('unique') as Error & { code: string };
          err.code = 'P2002';
          err.name = 'PrismaClientKnownRequestError';
          throw err;
        }
        const created: WarmupJobRow = {
          id: `wj_${warmupJobs.length + 1}`,
          ...data,
        };
        warmupJobs.push(created);
        return created;
      },
      findUnique: async ({
        where,
      }: {
        where: {
          mailboxId_usageDate_slotIndex: {
            mailboxId: string;
            usageDate: Date;
            slotIndex: number;
          };
        };
      }) => {
        const k = where.mailboxId_usageDate_slotIndex;
        return (
          warmupJobs.find(
            (j) =>
              j.mailboxId === k.mailboxId &&
              j.usageDate.getTime() === k.usageDate.getTime() &&
              j.slotIndex === k.slotIndex,
          ) ?? null
        );
      },
    },
    warmupDailyHistory: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          mailboxId_usageDate: { mailboxId: string; usageDate: Date };
        };
        create: { scheduledCount: number };
        update: { scheduledCount: { increment: number } };
      }) => {
        const key = `${where.mailboxId_usageDate.mailboxId}:${where.mailboxId_usageDate.usageDate.toISOString()}`;
        const existing = historyRows.get(key);
        if (existing) {
          existing.scheduledCount += update.scheduledCount.increment;
          return existing;
        }
        const created = { scheduledCount: create.scheduledCount };
        historyRows.set(key, created);
        return created;
      },
    },
  },
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

vi.mock('./job-service.js', () => ({
  warmupJobService: {
    createIfMissing: async (input: {
      workspaceId: string;
      mailboxId: string;
      configId: string;
      recipientId: string | null;
      recipientEmail: string;
      usageDate: Date;
      slotIndex: number;
      scheduledAt: Date;
      renderedSubject: string;
      renderedBody: string;
    }) => {
      const exists = warmupJobs.some(
        (j) =>
          j.mailboxId === input.mailboxId &&
          j.usageDate.getTime() === input.usageDate.getTime() &&
          j.slotIndex === input.slotIndex,
      );
      if (exists) {
        return { created: false };
      }
      const created: WarmupJobRow = {
        id: `wj_${warmupJobs.length + 1}`,
        mailboxId: input.mailboxId,
        usageDate: input.usageDate,
        slotIndex: input.slotIndex,
        scheduledAt: input.scheduledAt,
        status: 'QUEUED',
        workspaceId: input.workspaceId,
        configId: input.configId,
      };
      warmupJobs.push(created);
      return { created: true };
    },
    markDispatched: async () => undefined,
    markDeferred: async () => undefined,
  },
}));

vi.mock('./config-service.js', () => ({
  warmupConfigService: {
    markCompleted: async () => undefined,
  },
}));

const fakeQueue: Pick<Queue, 'add'> = {
  add: (async (_name: string, payload: unknown) => {
    enqueuedPayloads.push(payload);
    return { id: `bull_${enqueuedPayloads.length}` };
  }) as unknown as Queue['add'],
};

const fakeRecipientProvider = {
  select: async () => ({ id: 'r_1', email: 'friend@example.com', name: 'Friend' }),
};

function baseConfig(overrides: Partial<ConfigRow> = {}): ConfigRow {
  return {
    id: 'cfg_1',
    workspaceId: 'ws_1',
    mailboxId: 'mb_1',
    enabled: true,
    status: 'ACTIVE',
    currentDailyLimit: 3,
    maximumDailyLimit: 50,
    startingDailyLimit: 5,
    rampStep: 5,
    rampIntervalHours: 24,
    timezone: 'UTC',
    weekdays: [1, 2, 3, 4, 5],
    windowStart: '09:00',
    windowEnd: '17:00',
    startDate: new Date('2026-01-05T00:00:00Z'),
    lastProgressionAt: new Date('2026-01-05T00:00:00Z'),
    mailbox: {
      id: 'mb_1',
      workspaceId: 'ws_1',
      emailAddress: 'sender@example.com',
      fromName: 'Sender',
      timezone: 'UTC',
      healthStatus: 'HEALTHY',
      workspace: { timezone: 'UTC' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  warmupJobs.length = 0;
  configRows.length = 0;
  historyRows.clear();
  enqueuedPayloads.length = 0;
});

describe('WarmupSchedulerService.planDailyWarmupJobs', () => {
  it('is idempotent when planning the same day twice', async () => {
    const { WarmupSchedulerService } = await import('./scheduler.js');
    configRows.push(baseConfig());
    const scheduler = new WarmupSchedulerService(
      fakeQueue as Queue,
      fakeRecipientProvider,
    );
    const now = new Date('2026-01-05T12:00:00Z');
    const first = await scheduler.planDailyWarmupJobs(now);
    expect(first.planned).toBe(3);
    const second = await scheduler.planDailyWarmupJobs(now);
    expect(second.planned).toBe(0);
    expect(warmupJobs).toHaveLength(3);
  });

  it('creates no jobs when the day is not in weekdays', async () => {
    const { WarmupSchedulerService } = await import('./scheduler.js');
    configRows.push(
      baseConfig({
        weekdays: [1, 2, 3, 4, 5],
      }),
    );
    const scheduler = new WarmupSchedulerService(
      fakeQueue as Queue,
      fakeRecipientProvider,
    );
    // Saturday
    const now = new Date('2026-01-03T12:00:00Z');
    const result = await scheduler.planDailyWarmupJobs(now);
    expect(result.planned).toBe(0);
  });

  it('skips slots when no recipient is available', async () => {
    const { WarmupSchedulerService } = await import('./scheduler.js');
    configRows.push(baseConfig());
    const scheduler = new WarmupSchedulerService(fakeQueue as Queue, {
      select: async () => null,
    });
    const now = new Date('2026-01-05T12:00:00Z');
    const result = await scheduler.planDailyWarmupJobs(now);
    expect(result.planned).toBe(0);
  });
});

describe('WarmupSchedulerService.dispatchDueWarmupJobs', () => {
  it('does not dispatch jobs outside the sending window and defers them', async () => {
    const { WarmupSchedulerService } = await import('./scheduler.js');
    const scheduler = new WarmupSchedulerService(
      fakeQueue as Queue,
      fakeRecipientProvider,
    );

    // Craft a warmup job at 03:00 UTC (outside window) with matching config
    const usageDate = new Date('2026-01-05T00:00:00Z');
    warmupJobs.push({
      id: 'wj_1',
      mailboxId: 'mb_1',
      usageDate,
      slotIndex: 0,
      scheduledAt: new Date('2026-01-05T03:00:00Z'),
      status: 'QUEUED',
      workspaceId: 'ws_1',
      configId: 'cfg_1',
    });
    // Override findMany for warmupJob to return joined shape
    const { prisma } = (await import('@signalforge/database')) as unknown as {
      prisma: {
        warmupJob: { findMany: (args: unknown) => Promise<unknown[]> };
      };
    };
    prisma.warmupJob.findMany = async () => [
      {
        ...warmupJobs[0]!,
        config: baseConfig(),
        mailbox: baseConfig().mailbox,
      },
    ];

    const result = await scheduler.dispatchDueWarmupJobs(new Date('2026-01-05T03:00:00Z'));
    expect(result.dispatched).toBe(0);
    expect(result.deferred).toBe(1);
    expect(enqueuedPayloads).toHaveLength(0);
  });
});
