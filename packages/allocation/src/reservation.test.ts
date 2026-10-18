import { describe, expect, it, vi, beforeEach } from 'vitest';

interface Reservation {
  id: string;
  sendingJobId: string;
  mailboxId: string;
  poolId: string | null;
  usageDate: Date;
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  strategy: string;
  workspaceId: string;
}

interface Usage {
  mailboxId: string;
  usageDate: Date;
  sentCount: number;
  reservedCount: number;
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
    mailboxCapacityReservation: {
      findUnique: async ({ where }: { where: { sendingJobId?: string; id?: string } }) => {
        if (where.sendingJobId) return reservationsByJob.get(where.sendingJobId) ?? null;
        if (where.id) return reservations.get(where.id) ?? null;
        return null;
      },
      findFirst: async ({
        where,
      }: {
        where: { sendingJobId?: string; status?: { in?: string[] } };
      }) => {
        if (!where.sendingJobId) return null;
        const found = reservationsByJob.get(where.sendingJobId);
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
  mailboxCapacityReservation: {
    findUnique: async ({ where }: { where: { sendingJobId?: string; id?: string } }) => {
      if (where.sendingJobId) return reservationsByJob.get(where.sendingJobId) ?? null;
      if (where.id) return reservations.get(where.id) ?? null;
      return null;
    },
    create: async ({ data }: { data: Omit<Reservation, 'id' | 'status'> & { status: string } }) => {
      if (reservationsByJob.has(data.sendingJobId)) {
        const err = new Error('unique constraint') as Error & { code: string };
        err.code = 'P2002';
        err.name = 'PrismaClientKnownRequestError';
        throw err;
      }
      const created: Reservation = {
        id: `res_${reservations.size + 1}`,
        sendingJobId: data.sendingJobId,
        mailboxId: data.mailboxId,
        poolId: data.poolId ?? null,
        usageDate: data.usageDate,
        status: data.status as Reservation['status'],
        strategy: data.strategy,
        workspaceId: data.workspaceId,
      };
      reservations.set(created.id, created);
      reservationsByJob.set(created.sendingJobId, created);
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
      reservationsByJob.set(existing.sendingJobId, existing);
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
        sentCount?: { increment: number };
        reservedCount?: { increment?: number; decrement?: number };
      };
    }) => {
      const key = usageKey(where.mailboxId_usageDate.mailboxId, where.mailboxId_usageDate.usageDate);
      const found = usages.get(key);
      if (!found) throw new Error('not found');
      if (data.sentCount?.increment) found.sentCount += data.sentCount.increment;
      if (data.reservedCount?.increment) found.reservedCount += data.reservedCount.increment;
      if (data.reservedCount?.decrement) found.reservedCount -= data.reservedCount.decrement;
      return found;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        mailboxId: string;
        usageDate: Date;
        reservedCount: { lt: number };
      };
      data: { reservedCount: { increment: number } };
    }) => {
      const key = usageKey(where.mailboxId, where.usageDate);
      const found = usages.get(key);
      if (!found) return { count: 0 };
      if (found.reservedCount >= where.reservedCount.lt) return { count: 0 };
      found.reservedCount += data.reservedCount.increment;
      return { count: 1 };
    },
  },
};

beforeEach(() => {
  reservations.clear();
  reservationsByJob.clear();
  usages.clear();
});

describe('reserveCapacity', () => {
  it('reserves capacity when under the daily limit', async () => {
    const { reserveCapacity } = await import('./reservation.js');
    const result = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    expect(result.reused).toBe(false);
    const usage = [...usages.values()][0];
    expect(usage?.reservedCount).toBe(1);
  });

  it('is idempotent for the same sendingJobId', async () => {
    const { reserveCapacity } = await import('./reservation.js');
    const first = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    const second = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.reused).toBe(true);
    // reservedCount should not double
    const usage = [...usages.values()][0];
    expect(usage?.reservedCount).toBe(1);
  });

  it('never exceeds the daily limit under concurrent reservations', async () => {
    const { reserveCapacity, CapacityExhaustedError } = await import('./reservation.js');
    // Cap = 5, try to reserve 10 unique jobs
    const attempts = [];
    for (let i = 0; i < 10; i += 1) {
      attempts.push(
        reserveCapacity({
          workspaceId: 'ws_1',
          sendingJobId: `job_${i}`,
          mailboxId: 'mb_1',
          poolId: null,
          usageDate: '2026-01-01',
          dailyLimit: 5,
          strategy: 'ROUND_ROBIN',
        }).catch((error) => error),
      );
    }
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => !(r instanceof Error));
    const exhausted = results.filter((r) => r instanceof CapacityExhaustedError);
    expect(successes).toHaveLength(5);
    expect(exhausted.length).toBeGreaterThan(0);
    const usage = [...usages.values()][0];
    expect(usage?.reservedCount).toBe(5);
  });
});

describe('consumeReservation', () => {
  it('increments sent and decrements reserved atomically', async () => {
    const { reserveCapacity, consumeReservation } = await import('./reservation.js');
    const res = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    await consumeReservation({ reservationId: res.reservationId });
    const usage = [...usages.values()][0];
    expect(usage?.sentCount).toBe(1);
    expect(usage?.reservedCount).toBe(0);
  });

  it('is safe to call twice', async () => {
    const { reserveCapacity, consumeReservation } = await import('./reservation.js');
    const res = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    await consumeReservation({ reservationId: res.reservationId });
    await consumeReservation({ reservationId: res.reservationId });
    const usage = [...usages.values()][0];
    expect(usage?.sentCount).toBe(1);
  });
});

describe('releaseReservation', () => {
  it('decrements reserved and marks as released', async () => {
    const { reserveCapacity, releaseReservation } = await import('./reservation.js');
    const res = await reserveCapacity({
      workspaceId: 'ws_1',
      sendingJobId: 'job_1',
      mailboxId: 'mb_1',
      poolId: null,
      usageDate: '2026-01-01',
      dailyLimit: 10,
      strategy: 'ROUND_ROBIN',
    });
    await releaseReservation({ reservationId: res.reservationId, reason: 'test' });
    const usage = [...usages.values()][0];
    expect(usage?.reservedCount).toBe(0);
    expect(usage?.sentCount).toBe(0);
    expect(reservations.get(res.reservationId)?.status).toBe('RELEASED');
  });
});
