import { prisma, Prisma } from '@signalforge/database';
import type { CapacityReservationStatus, RotationStrategy } from './types.js';

export interface ReserveCapacityInput {
  workspaceId: string;
  sendingJobId: string;
  mailboxId: string;
  poolId: string | null;
  usageDate: string;
  dailyLimit: number;
  strategy: RotationStrategy;
}

export interface ReserveCapacityResult {
  reservationId: string;
  reused: boolean;
}

export class ReservationConflictError extends Error {
  constructor(message = 'Capacity reservation conflict') {
    super(message);
    this.name = 'ReservationConflictError';
  }
}

export class CapacityExhaustedError extends Error {
  constructor(message = 'Mailbox daily capacity exhausted') {
    super(message);
    this.name = 'CapacityExhaustedError';
  }
}

function toDateOnly(usageDate: string): Date {
  return new Date(`${usageDate}T00:00:00.000Z`);
}

/**
 * Atomically reserve one send unit for the mailbox on the given usage date.
 * - Idempotent by sendingJobId: an existing RESERVED/CONSUMED row for the same
 *   job returns immediately (reused=true) instead of double-incrementing.
 * - Enforces capacity: throws CapacityExhaustedError if
 *   sentCount + reservedCount would exceed dailyLimit.
 *   The mailbox row is upserted with reservedCount=1 (fresh) or conditionally
 *   incremented via a WHERE clause on (sentCount + reservedCount) < dailyLimit.
 */
export async function reserveCapacity(input: ReserveCapacityInput): Promise<ReserveCapacityResult> {
  const usageDate = toDateOnly(input.usageDate);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.mailboxCapacityReservation.findUnique({
      where: { sendingJobId: input.sendingJobId },
    });
    if (existing && existing.status !== 'RELEASED') {
      return { reservationId: existing.id, reused: true };
    }

    const usage = await tx.mailboxDailyUsage.upsert({
      where: { mailboxId_usageDate: { mailboxId: input.mailboxId, usageDate } },
      create: { mailboxId: input.mailboxId, usageDate, sentCount: 0, reservedCount: 0 },
      update: {},
    });

    if (usage.sentCount + usage.reservedCount >= input.dailyLimit) {
      throw new CapacityExhaustedError(
        `Mailbox ${input.mailboxId} at limit (${input.dailyLimit})`,
      );
    }

    const updated = await tx.mailboxDailyUsage.updateMany({
      where: {
        mailboxId: input.mailboxId,
        usageDate,
        // Conditional guard: only increment if capacity remains.
        // We express (sent + reserved < limit) as reservedCount < (limit - sent).
        reservedCount: { lt: input.dailyLimit - usage.sentCount },
      },
      data: { reservedCount: { increment: 1 } },
    });

    if (updated.count === 0) {
      throw new ReservationConflictError('Concurrent update prevented reservation');
    }

    if (existing) {
      const revived = await tx.mailboxCapacityReservation.update({
        where: { id: existing.id },
        data: {
          status: 'RESERVED',
          mailboxId: input.mailboxId,
          poolId: input.poolId,
          usageDate,
          strategy: input.strategy,
          reservedAt: new Date(),
          releasedAt: null,
          releaseReason: null,
        },
      });
      return { reservationId: revived.id, reused: false };
    }

    try {
      const created = await tx.mailboxCapacityReservation.create({
        data: {
          workspaceId: input.workspaceId,
          sendingJobId: input.sendingJobId,
          mailboxId: input.mailboxId,
          poolId: input.poolId,
          usageDate,
          status: 'RESERVED',
          strategy: input.strategy,
        },
      });
      return { reservationId: created.id, reused: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ReservationConflictError('Reservation already exists for job');
      }
      throw error;
    }
  });
}

export interface ConsumeReservationInput {
  reservationId: string;
}

export async function consumeReservation(input: ConsumeReservationInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.mailboxCapacityReservation.findUnique({
      where: { id: input.reservationId },
    });
    if (!reservation) return;
    if (reservation.status === 'CONSUMED') return;
    if (reservation.status === 'RELEASED') {
      throw new Error(`Cannot consume released reservation ${input.reservationId}`);
    }

    await tx.mailboxDailyUsage.update({
      where: {
        mailboxId_usageDate: {
          mailboxId: reservation.mailboxId,
          usageDate: reservation.usageDate,
        },
      },
      data: {
        sentCount: { increment: 1 },
        reservedCount: { decrement: 1 },
      },
    });

    await tx.mailboxCapacityReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
  });
}

export interface ReleaseReservationInput {
  reservationId: string;
  reason: string;
}

export async function releaseReservation(input: ReleaseReservationInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.mailboxCapacityReservation.findUnique({
      where: { id: input.reservationId },
    });
    if (!reservation) return;
    if (reservation.status !== 'RESERVED') return;

    await tx.mailboxDailyUsage.update({
      where: {
        mailboxId_usageDate: {
          mailboxId: reservation.mailboxId,
          usageDate: reservation.usageDate,
        },
      },
      data: { reservedCount: { decrement: 1 } },
    });

    await tx.mailboxCapacityReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        releaseReason: input.reason,
      },
    });
  });
}

export async function findActiveReservation(sendingJobId: string) {
  return prisma.mailboxCapacityReservation.findFirst({
    where: {
      sendingJobId,
      status: { in: ['RESERVED', 'CONSUMED'] satisfies CapacityReservationStatus[] },
    },
  });
}
