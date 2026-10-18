import { describe, expect, it, vi, beforeEach } from 'vitest';

interface Reservation {
  id: string;
  warmupJobId: string;
  mailboxId: string;
  usageDate: Date;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  workspaceId: string;
}

interface Usage {
  mailboxId: string;
  usageDate: Date;
  sentCount: number;
  reservedCount: number;
  warmupSentCount: number;
  warmupReservedCount: number;
}

const reservations = new Map<string, Reservation>();
const reservationsByJob = new Map<string, Reservation>();
const usages = new Map<string, Usage>();

function usageKey(mailboxId: string, usageDate: Date) {
  return `${mailboxId}:${usageDate.toISOString()}`;
}

vi.mock('@signalforge/database', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy),
    warmupCapacityReservation: {
      findUnique: async ({ where }: { where: { warmupJobId?: string; id?: string } }) => {
        if (where.warmupJobId) return reservationsByJob.get(where.warmupJobId) ?? null;
        if (where.id) return reservations.get(where.id) ?? null;
        return null;
      },
      findFirst: async ({
        where,
      }: {
        where: { warmupJobId?: string; status?: { in?: string[] } };
      }) => {
        if (!where.warmupJobId) return null;
        const found = reservationsByJob.get(where.warmupJobId);
        if (!found) return null;
        if (where.status?.in && !where.status.in.includes(found.status)) return null;
        return found;
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

const txProxy = {
  warmupCapacityReservation: {
    findUnique: async ({ where }: { where: { warmupJobId?: string; id?: string } }) => {
      if (where.warmupJobId) return reservationsByJob.get(where.warmupJobId) ?? null;
      if (where.id) return reservations.get(where.id) ?? null;
      return null;
    },
    create: async ({ data }: { data: Omit<Reservation, 'id' | 'status'> & { status: string } }) => {
      if (reservationsByJob.has(data.warmupJobId)) {
        const err = new Error('unique constraint') as Error & { code: string };
        err.code = 'P2002';
        err.name = 'PrismaClientKnownRequestError';
        throw err;
      }
      const created: Reservation = {
        id: `res_${reservations.size + 1}`,
        warmupJobId: data.warmupJobId,
        mailboxId: data.mailboxId,
        usageDate: data.usageDate,
        status: data.status as Reservation['status'],
        workspaceId: data.workspaceId,
      };
      reservations.set(created.id, created);
      reservationsByJob.set(created.warmupJobId, created);
      return created;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Reservation>;
    }) => {
      const existing = reservations.get(where.id);
      if (!existing) throw new Error('not found');
      Object.assign(existing, data);
      reservationsByJob.set(existing.warmupJobId, existing);
      return existing;
    },
  },
  mailboxDailyUsage: {
    upsert: async ({
      where,
      create,
    }: {
      where: { mailboxId_usageDate: { mailboxId: string; usageDate: Date } };
      create: Usage;
    }) => {
      const key = usageKey(where.mailboxId_usageDate.mailboxId, where.mailboxId_usageDate.usageDate);
      const found = usages.get(key);
      if (found) return found;
      const created = { ...create };
      usages.set(key, created);
      return created;
    },
    update: async ({
      where,
      data,
    }: {
      where: { mailboxId_usageDate: { mailboxId: string; usageDate: Date } };
      data: {
        warmupSentCount?: { increment: number };
        warmupReservedCount?: { increment?: number; decrement?: number };
      };
    }) => {
      const key = usageKey(where.mailboxId_usageDate.mailboxId, where.mailboxId_usageDate.usageDate);
      const found = usages.get(key);
      if (!found) throw new Error('not found');
      if (data.warmupSentCount?.increment) found.warmupSentCount += data.warmupSentCount.increment;
      if (data.warmupReservedCount?.increment)
        found.warmupReservedCount += data.warmupReservedCount.increment;
      if (data.warmupReservedCount?.decrement)
        found.warmupReservedCount -= data.warmupReservedCount.decrement;
      return found;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        mailboxId: string;
        usageDate: Date;
        warmupReservedCount: { lt: number };
      };
      data: { warmupReservedCount: { increment: number } };
    }) => {
      const key = usageKey(where.mailboxId, where.usageDate);
      const found = usages.get(key);
      if (!found) return { count: 0 };
      if (found.warmupReservedCount >= where.warmupReservedCount.lt) return { count: 0 };
      found.warmupReservedCount += data.warmupReservedCount.increment;
      return { count: 1 };
    },
  },
};

beforeEach(() => {
  reservations.clear();
  reservationsByJob.clear();
  usages.clear();
});

describe('reserveWarmupCapacity', () => {
  it('reserves capacity when under both warmup and account limits', async () => {
    const { reserveWarmupCapacity } = await import('./reservation.js');
    const result = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 5,
      accountDailyLimit: 100,
    });
    expect(result.reused).toBe(false);
    const usage = [...usages.values()][0];
    expect(usage?.warmupReservedCount).toBe(1);
  });

  it('is idempotent for the same warmup job', async () => {
    const { reserveWarmupCapacity } = await import('./reservation.js');
    const first = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 5,
      accountDailyLimit: 100,
    });
    const second = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 5,
      accountDailyLimit: 100,
    });
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.reused).toBe(true);
    const usage = [...usages.values()][0];
    expect(usage?.warmupReservedCount).toBe(1);
  });

  it('never exceeds the warmup daily limit under concurrent reservations', async () => {
    const { reserveWarmupCapacity, WarmupCapacityExhaustedError } = await import(
      './reservation.js'
    );
    const attempts = [];
    for (let i = 0; i < 10; i += 1) {
      attempts.push(
        reserveWarmupCapacity({
          workspaceId: 'ws_1',
          warmupJobId: `wj_${i}`,
          mailboxId: 'mb_1',
          usageDate: '2026-01-05',
          warmupDailyLimit: 3,
          accountDailyLimit: 100,
        }).catch((error) => error),
      );
    }
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => !(r instanceof Error));
    const exhausted = results.filter((r) => r instanceof WarmupCapacityExhaustedError);
    expect(successes).toHaveLength(3);
    expect(exhausted.length).toBeGreaterThan(0);
  });

  it('respects the account daily limit even when warmup limit is high', async () => {
    const { reserveWarmupCapacity, WarmupCapacityExhaustedError } = await import(
      './reservation.js'
    );
    // Pre-populate usage with 4 sent + 5 reserved = 9, account limit 10 → only 1 warmup slot
    const usageDate = new Date('2026-01-05T00:00:00.000Z');
    usages.set(usageKey('mb_1', usageDate), {
      mailboxId: 'mb_1',
      usageDate,
      sentCount: 4,
      reservedCount: 5,
      warmupSentCount: 0,
      warmupReservedCount: 0,
    });
    const first = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 50,
      accountDailyLimit: 10,
    });
    expect(first.reused).toBe(false);
    await expect(
      reserveWarmupCapacity({
        workspaceId: 'ws_1',
        warmupJobId: 'wj_2',
        mailboxId: 'mb_1',
        usageDate: '2026-01-05',
        warmupDailyLimit: 50,
        accountDailyLimit: 10,
      }),
    ).rejects.toBeInstanceOf(WarmupCapacityExhaustedError);
  });
});

describe('consumeWarmupReservation', () => {
  it('increments warmup sent and decrements reserved', async () => {
    const { reserveWarmupCapacity, consumeWarmupReservation } = await import('./reservation.js');
    const res = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 10,
      accountDailyLimit: 100,
    });
    await consumeWarmupReservation({ reservationId: res.reservationId });
    const usage = [...usages.values()][0];
    expect(usage?.warmupSentCount).toBe(1);
    expect(usage?.warmupReservedCount).toBe(0);
  });
});

describe('releaseWarmupReservation', () => {
  it('decrements reserved and marks reservation released', async () => {
    const { reserveWarmupCapacity, releaseWarmupReservation } = await import('./reservation.js');
    const res = await reserveWarmupCapacity({
      workspaceId: 'ws_1',
      warmupJobId: 'wj_1',
      mailboxId: 'mb_1',
      usageDate: '2026-01-05',
      warmupDailyLimit: 10,
      accountDailyLimit: 100,
    });
    await releaseWarmupReservation({
      reservationId: res.reservationId,
      reason: 'test',
    });
    const usage = [...usages.values()][0];
    expect(usage?.warmupReservedCount).toBe(0);
    expect(reservations.get(res.reservationId)?.status).toBe('RELEASED');
  });
});
