import { prisma, Prisma, type WarmupReservationStatus } from '@signalforge/database';

export interface ReserveWarmupCapacityInput {
  workspaceId: string;
  warmupJobId: string;
  mailboxId: string;
  usageDate: string;
  warmupDailyLimit: number;
  accountDailyLimit: number;
}

export interface ReserveWarmupCapacityResult {
  reservationId: string;
  reused: boolean;
}

export class WarmupReservationConflictError extends Error {
  constructor(message = 'Warmup capacity reservation conflict') {
    super(message);
    this.name = 'WarmupReservationConflictError';
  }
}

export class WarmupCapacityExhaustedError extends Error {
  constructor(message = 'Warmup capacity exhausted') {
    super(message);
    this.name = 'WarmupCapacityExhaustedError';
  }
}

function toDateOnly(usageDate: string): Date {
  return new Date(`${usageDate}T00:00:00.000Z`);
}

/**
 * Reserve one warmup send unit for the mailbox on the given usage date.
 * Enforces both the warmup daily limit (currentDailyLimit) and the overall
 * account daily limit (mailbox.dailySendingLimit), which is shared with
 * campaign sends.
 */
export async function reserveWarmupCapacity(
  input: ReserveWarmupCapacityInput,
): Promise<ReserveWarmupCapacityResult> {
  const usageDate = toDateOnly(input.usageDate);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.warmupCapacityReservation.findUnique({
      where: { warmupJobId: input.warmupJobId },
    });
    if (existing && existing.status !== 'RELEASED') {
      return { reservationId: existing.id, reused: true };
    }

    const usage = await tx.mailboxDailyUsage.upsert({
      where: { mailboxId_usageDate: { mailboxId: input.mailboxId, usageDate } },
      create: {
        mailboxId: input.mailboxId,
        usageDate,
        sentCount: 0,
        reservedCount: 0,
        warmupSentCount: 0,
        warmupReservedCount: 0,
      },
      update: {},
    });

    const warmupUsed = usage.warmupSentCount + usage.warmupReservedCount;
    const totalUsed =
      usage.sentCount + usage.reservedCount + usage.warmupSentCount + usage.warmupReservedCount;

    if (warmupUsed >= input.warmupDailyLimit) {
      throw new WarmupCapacityExhaustedError(
        `Warmup daily limit reached (${input.warmupDailyLimit})`,
      );
    }
    if (totalUsed >= input.accountDailyLimit) {
      throw new WarmupCapacityExhaustedError(
        `Account daily limit reached (${input.accountDailyLimit})`,
      );
    }

    const updated = await tx.mailboxDailyUsage.updateMany({
      where: {
        mailboxId: input.mailboxId,
        usageDate,
        warmupReservedCount: {
          lt: input.warmupDailyLimit - usage.warmupSentCount,
        },
      },
      data: { warmupReservedCount: { increment: 1 } },
    });

    if (updated.count === 0) {
      throw new WarmupReservationConflictError(
        'Concurrent update prevented warmup reservation',
      );
    }

    if (existing) {
      const revived = await tx.warmupCapacityReservation.update({
        where: { id: existing.id },
        data: {
          status: 'RESERVED',
          mailboxId: input.mailboxId,
          usageDate,
          reservedAt: new Date(),
          releasedAt: null,
          releaseReason: null,
        },
      });
      return { reservationId: revived.id, reused: false };
    }

    try {
      const created = await tx.warmupCapacityReservation.create({
        data: {
          workspaceId: input.workspaceId,
          warmupJobId: input.warmupJobId,
          mailboxId: input.mailboxId,
          usageDate,
          status: 'RESERVED',
        },
      });
      return { reservationId: created.id, reused: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new WarmupReservationConflictError('Warmup reservation already exists');
      }
      throw error;
    }
  });
}

export interface ConsumeWarmupReservationInput {
  reservationId: string;
}

export async function consumeWarmupReservation(
  input: ConsumeWarmupReservationInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.warmupCapacityReservation.findUnique({
      where: { id: input.reservationId },
    });
    if (!reservation) return;
    if (reservation.status === 'CONSUMED') return;
    if (reservation.status === 'RELEASED') {
      throw new Error(`Cannot consume released warmup reservation ${input.reservationId}`);
    }

    await tx.mailboxDailyUsage.update({
      where: {
        mailboxId_usageDate: {
          mailboxId: reservation.mailboxId,
          usageDate: reservation.usageDate,
        },
      },
      data: {
        warmupSentCount: { increment: 1 },
        warmupReservedCount: { decrement: 1 },
      },
    });

    await tx.warmupCapacityReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
  });
}

export interface ReleaseWarmupReservationInput {
  reservationId: string;
  reason: string;
}

export async function releaseWarmupReservation(
  input: ReleaseWarmupReservationInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.warmupCapacityReservation.findUnique({
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
      data: { warmupReservedCount: { decrement: 1 } },
    });

    await tx.warmupCapacityReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        releaseReason: input.reason,
      },
    });
  });
}

export async function findActiveWarmupReservation(warmupJobId: string) {
  return prisma.warmupCapacityReservation.findFirst({
    where: {
      warmupJobId,
      status: { in: ['RESERVED', 'CONSUMED'] satisfies WarmupReservationStatus[] },
    },
  });
}
