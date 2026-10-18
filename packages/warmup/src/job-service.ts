import { prisma, Prisma, type WarmupJob, type WarmupJobStatus } from '@signalforge/database';

export interface CreateWarmupJobInput {
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
}

export class WarmupJobService {
  async createIfMissing(input: CreateWarmupJobInput): Promise<{ job: WarmupJob; created: boolean }> {
    try {
      const job = await prisma.warmupJob.create({
        data: {
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
          configId: input.configId,
          recipientId: input.recipientId,
          recipientEmail: input.recipientEmail,
          usageDate: input.usageDate,
          slotIndex: input.slotIndex,
          scheduledAt: input.scheduledAt,
          status: 'QUEUED',
          renderedSubject: input.renderedSubject,
          renderedBody: input.renderedBody,
        },
      });
      return { job, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.warmupJob.findUnique({
          where: {
            mailboxId_usageDate_slotIndex: {
              mailboxId: input.mailboxId,
              usageDate: input.usageDate,
              slotIndex: input.slotIndex,
            },
          },
        });
        if (existing) return { job: existing, created: false };
      }
      throw error;
    }
  }

  async claimJob(jobId: string): Promise<WarmupJob | null> {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.warmupJob.findUnique({ where: { id: jobId } });
        if (!current) return null;
        if (current.status !== 'QUEUED' && current.status !== 'DISPATCHED') {
          return null;
        }
        return tx.warmupJob.update({
          where: { id: jobId },
          data: {
            status: 'IN_PROGRESS',
            claimedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }

  async markDispatched(jobId: string, bullmqJobId: string | null): Promise<void> {
    await prisma.warmupJob.update({
      where: { id: jobId },
      data: {
        status: 'DISPATCHED',
        bullmqJobId,
      },
    });
  }

  async markSent(jobId: string, data: { providerMessageId?: string | null }): Promise<WarmupJob> {
    return prisma.warmupJob.update({
      where: { id: jobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: data.providerMessageId ?? null,
        lastError: null,
        errorCategory: null,
      },
    });
  }

  async markFailed(
    jobId: string,
    data: { errorCategory: string; message: string },
  ): Promise<WarmupJob> {
    return prisma.warmupJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorCategory: data.errorCategory as never,
        lastError: data.message.slice(0, 500),
      },
    });
  }

  async markDeferred(
    jobId: string,
    data: { reason: string; nextScheduledAt: Date | null },
  ): Promise<WarmupJob> {
    return prisma.warmupJob.update({
      where: { id: jobId },
      data: {
        status: 'DEFERRED',
        lastError: data.reason.slice(0, 500),
        scheduledAt: data.nextScheduledAt ?? undefined,
      },
    });
  }

  async cancel(jobId: string): Promise<WarmupJob> {
    return prisma.warmupJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async countByStatus(mailboxId: string, usageDate: Date) {
    const rows = await prisma.warmupJob.groupBy({
      by: ['status'],
      where: { mailboxId, usageDate },
      _count: { _all: true },
    });
    const base: Record<WarmupJobStatus, number> = {
      QUEUED: 0,
      DISPATCHED: 0,
      IN_PROGRESS: 0,
      SENT: 0,
      DEFERRED: 0,
      FAILED: 0,
      CANCELLED: 0,
      PAUSED: 0,
    };
    for (const row of rows) base[row.status] = row._count._all;
    return base;
  }
}

export const warmupJobService = new WarmupJobService();
