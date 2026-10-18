import { DateTime } from 'luxon';
import type { Queue } from 'bullmq';
import { prisma, Prisma } from '@signalforge/database';
import { logInboxEvent } from './activity.js';
import type { InboxSchedulerTickResult, InboxSyncQueuePayload } from './types.js';

const DISPATCH_BATCH = 50;

export class InboxSchedulerService {
  constructor(private readonly inboxSyncQueue: Queue<InboxSyncQueuePayload>) {}

  async scheduleDueSyncJobs(now: Date = new Date()): Promise<{ scheduled: number }> {
    const mailboxes = await prisma.mailbox.findMany({
      where: {
        inboundEnabled: true,
        status: { in: ['ACTIVE'] },
        inboundConfig: { enabled: true },
      },
      include: {
        inboundConfig: true,
        syncState: true,
      },
    });

    let scheduled = 0;
    for (const mailbox of mailboxes) {
      if (!mailbox.inboundConfig) continue;
      const intervalMinutes = mailbox.inboundConfig.syncIntervalMinutes || 5;
      const lastSync = mailbox.lastInboundSyncAt ?? mailbox.syncState?.lastSyncAt;
      if (lastSync) {
        const nextDue = DateTime.fromJSDate(lastSync).plus({ minutes: intervalMinutes });
        if (nextDue > DateTime.fromJSDate(now)) continue;
      }

      const runKey = DateTime.fromJSDate(now).toUTC().toFormat('yyyy-MM-dd-HH-mm');
      try {
        const job = await prisma.inboxSyncJob.create({
          data: {
            workspaceId: mailbox.workspaceId,
            mailboxId: mailbox.id,
            runKey,
            status: 'QUEUED',
          },
        });
        scheduled += 1;
        logInboxEvent('Inbox sync job scheduled', {
          workspaceId: mailbox.workspaceId,
          mailboxId: mailbox.id,
          syncJobId: job.id,
          status: 'scheduled',
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        logInboxEvent('Failed to schedule inbox sync job', {
          workspaceId: mailbox.workspaceId,
          mailboxId: mailbox.id,
          error: error instanceof Error ? error.message : 'unknown',
          status: 'schedule_error',
        });
      }
    }

    return { scheduled };
  }

  async dispatchQueuedSyncJobs(
    now: Date = new Date(),
    limit: number = DISPATCH_BATCH,
  ): Promise<{ dispatched: number; deferred: number; errors: number }> {
    const dueJobs = await prisma.inboxSyncJob.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        mailbox: {
          select: { inboundEnabled: true, inboundConfig: { select: { enabled: true } } },
        },
      },
    });

    let dispatched = 0;
    let deferred = 0;
    let errors = 0;

    for (const job of dueJobs) {
      try {
        if (!job.mailbox.inboundEnabled || !job.mailbox.inboundConfig?.enabled) {
          await prisma.inboxSyncJob.update({
            where: { id: job.id },
            data: { status: 'CANCELLED', completedAt: now },
          });
          deferred += 1;
          continue;
        }

        const payload: InboxSyncQueuePayload = {
          inboxSyncJobId: job.id,
          workspaceId: job.workspaceId,
          mailboxId: job.mailboxId,
        };

        const bullJob = await this.inboxSyncQueue.add('inbox-sync', payload, {
          jobId: `inbox-sync-${job.id}`,
          removeOnComplete: 500,
          removeOnFail: 1000,
        });

        await prisma.inboxSyncJob.update({
          where: { id: job.id },
          data: {
            status: 'DISPATCHED',
            bullmqJobId: bullJob.id ?? null,
            startedAt: now,
          },
        });

        dispatched += 1;
      } catch (error) {
        errors += 1;
        await prisma.inboxSyncJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Dispatch failed',
            completedAt: now,
          },
        });
        logInboxEvent('Failed to dispatch inbox sync job', {
          workspaceId: job.workspaceId,
          mailboxId: job.mailboxId,
          syncJobId: job.id,
          error: error instanceof Error ? error.message : 'unknown',
          status: 'dispatch_error',
        });
      }
    }

    return { dispatched, deferred, errors };
  }

  async completeSyncJob(
    inboxSyncJobId: string,
    result: { fetched: number; processed: number; duplicates: number; errors: number },
  ): Promise<void> {
    await prisma.inboxSyncJob.update({
      where: { id: inboxSyncJobId },
      data: {
        status: result.errors > 0 ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
        messagesFetched: result.fetched,
        messagesProcessed: result.processed,
        errorMessage: result.errors > 0 ? `${result.errors} message processing errors` : null,
      },
    });
  }

  async runTick(now: Date = new Date()): Promise<InboxSchedulerTickResult> {
    const schedule = await this.scheduleDueSyncJobs(now);
    const dispatch = await this.dispatchQueuedSyncJobs(now);
    return {
      scheduled: schedule.scheduled,
      dispatched: dispatch.dispatched,
      deferred: dispatch.deferred,
      errors: dispatch.errors,
    };
  }
}

export function createInboxSchedulerService(
  inboxSyncQueue: Queue<InboxSyncQueuePayload>,
): InboxSchedulerService {
  return new InboxSchedulerService(inboxSyncQueue);
}
