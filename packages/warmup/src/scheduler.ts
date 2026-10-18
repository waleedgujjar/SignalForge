import { DateTime } from 'luxon';
import type { Queue } from 'bullmq';
import { prisma, type EmailWarmupConfig } from '@signalforge/database';
import { computeCurrentLimit, advanceLimit, isWarmupComplete } from './ramp-calculator.js';
import {
  computeUsageDate,
  distributeSlots,
  isWithinWarmupWindow,
  toUsageDate,
  usageDateStart,
} from './schedule-calculator.js';
import { warmupJobService } from './job-service.js';
import { warmupConfigService } from './config-service.js';
import { defaultRecipientProvider, type WarmupRecipientProvider } from './recipient-provider.js';
import { renderWarmupTemplate } from './templates.js';
import { logWarmupEvent } from './activity.js';
import { parseWeekdays } from './eligibility.js';
import type { WarmupQueuePayload } from './types.js';

const DISPATCH_BATCH = 100;

export interface WarmupSchedulerTickResult {
  planned: number;
  progressed: number;
  completed: number;
  dispatched: number;
  deferred: number;
  errors: number;
}

export class WarmupSchedulerService {
  constructor(
    private readonly warmupQueue: Queue<WarmupQueuePayload>,
    private readonly recipientProvider: WarmupRecipientProvider = defaultRecipientProvider,
  ) {}

  async planDailyWarmupJobs(now: Date = new Date()): Promise<{ planned: number }> {
    const configs = await prisma.emailWarmupConfig.findMany({
      where: { enabled: true, status: 'ACTIVE' },
      include: {
        mailbox: { include: { workspace: true } },
      },
    });

    let planned = 0;
    for (const config of configs) {
      try {
        planned += await this.planForConfig(config, now);
      } catch (error) {
        logWarmupEvent('Failed to plan warmup jobs for config', {
          workspaceId: config.workspaceId,
          mailboxId: config.mailboxId,
          configId: config.id,
          status: 'plan_error',
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return { planned };
  }

  private async planForConfig(
    config: EmailWarmupConfig & {
      mailbox: { workspaceId: string; emailAddress: string; fromName: string; timezone: string | null; workspace: { timezone: string } };
    },
    now: Date,
  ): Promise<number> {
    const timezone = config.timezone || config.mailbox.timezone || config.mailbox.workspace.timezone || 'UTC';
    const weekdays = parseWeekdays(config.weekdays);
    const scheduleConfig = {
      timezone,
      weekdays,
      windowStart: config.windowStart,
      windowEnd: config.windowEnd,
    };

    const usageDateStr = computeUsageDate(now, timezone);
    const localDate = usageDateStart(usageDateStr, timezone);
    const day = (localDate.weekday as number) % 7;
    if (!weekdays.includes(day)) return 0;

    const currentLimit = config.currentDailyLimit;
    if (currentLimit <= 0) return 0;

    const slots = distributeSlots(currentLimit, localDate, scheduleConfig);
    if (slots.length === 0) return 0;

    const existing = await prisma.warmupJob.findMany({
      where: {
        mailboxId: config.mailboxId,
        usageDate: toUsageDate(usageDateStr),
      },
      select: { slotIndex: true, scheduledAt: true, status: true },
    });
    const existingSlots = new Set(existing.map((j) => j.slotIndex));

    let created = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const scheduledAt = slots[i];
      if (!scheduledAt || existingSlots.has(i)) continue;
      const recipient = await this.recipientProvider.select({
        workspaceId: config.workspaceId,
        mailboxId: config.mailboxId,
        excludeEmail: config.mailbox.emailAddress,
      });
      if (!recipient) {
        logWarmupEvent('Skipping slot: no eligible warmup recipient', {
          workspaceId: config.workspaceId,
          mailboxId: config.mailboxId,
          configId: config.id,
          slotIndex: i,
          status: 'skipped_no_recipient',
        });
        continue;
      }
      const template = renderWarmupTemplate({
        slotIndex: i,
        fromName: config.mailbox.fromName,
        fromEmail: config.mailbox.emailAddress,
        recipientName: recipient.name,
        sentDate: scheduledAt,
      });
      const { created: didCreate } = await warmupJobService.createIfMissing({
        workspaceId: config.workspaceId,
        mailboxId: config.mailboxId,
        configId: config.id,
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        usageDate: toUsageDate(usageDateStr),
        slotIndex: i,
        scheduledAt,
        renderedSubject: template.subject,
        renderedBody: template.body,
      });
      if (didCreate) created += 1;
    }

    if (created > 0) {
      await prisma.warmupDailyHistory.upsert({
        where: {
          mailboxId_usageDate: {
            mailboxId: config.mailboxId,
            usageDate: toUsageDate(usageDateStr),
          },
        },
        create: {
          workspaceId: config.workspaceId,
          mailboxId: config.mailboxId,
          usageDate: toUsageDate(usageDateStr),
          configuredLimit: currentLimit,
          scheduledCount: created,
          statusSnapshot: config.status,
        },
        update: {
          configuredLimit: currentLimit,
          scheduledCount: { increment: created },
          statusSnapshot: config.status,
        },
      });
    }

    return created;
  }

  /**
   * Progress the ramp for each active config when its interval elapses and
   * mark warmups as completed when they reach the maximum. Also clears
   * "PAUSED" jobs older than 30 days as a safety net (not strictly needed).
   */
  async advanceDailyLimits(now: Date = new Date()): Promise<{ progressed: number; completed: number }> {
    const configs = await prisma.emailWarmupConfig.findMany({
      where: { enabled: true, status: 'ACTIVE' },
      include: { mailbox: true },
    });
    let progressed = 0;
    let completed = 0;

    for (const config of configs) {
      const holdRamp = config.mailbox.healthStatus === 'DEGRADED';
      const result = computeCurrentLimit({
        startingDailyLimit: config.startingDailyLimit,
        maximumDailyLimit: config.maximumDailyLimit,
        rampStep: config.rampStep,
        rampIntervalHours: config.rampIntervalHours,
        startDate: config.startDate,
        lastProgressionAt: config.lastProgressionAt,
        now,
        holdRamp,
      });

      if (isWarmupComplete(config.currentDailyLimit, config.maximumDailyLimit)) {
        await warmupConfigService.markCompleted(config.mailboxId, config.workspaceId);
        completed += 1;
        continue;
      }

      if (!result.shouldProgress) continue;
      const nextLimit = advanceLimit(config.currentDailyLimit, config.rampStep, config.maximumDailyLimit);
      if (nextLimit === config.currentDailyLimit) continue;
      await prisma.emailWarmupConfig.update({
        where: { id: config.id },
        data: {
          currentDailyLimit: nextLimit,
          lastProgressionAt: now,
        },
      });
      logWarmupEvent('Warmup daily limit advanced', {
        workspaceId: config.workspaceId,
        mailboxId: config.mailboxId,
        configId: config.id,
        currentLimit: nextLimit,
        status: 'progressed',
      });
      progressed += 1;

      if (isWarmupComplete(nextLimit, config.maximumDailyLimit)) {
        await warmupConfigService.markCompleted(config.mailboxId, config.workspaceId);
        completed += 1;
      }
    }
    return { progressed, completed };
  }

  async dispatchDueWarmupJobs(
    now: Date = new Date(),
    limit: number = DISPATCH_BATCH,
  ): Promise<{ dispatched: number; deferred: number; errors: number }> {
    const dueJobs = await prisma.warmupJob.findMany({
      where: {
        status: 'QUEUED',
        scheduledAt: { lte: now },
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: limit,
      include: {
        config: true,
        mailbox: {
          include: { workspace: true },
        },
      },
    });

    let dispatched = 0;
    let deferred = 0;
    let errors = 0;
    for (const job of dueJobs) {
      try {
        if (!job.config.enabled || job.config.status !== 'ACTIVE') {
          await warmupJobService.markDeferred(job.id, {
            reason: `Config not active: ${job.config.status}`,
            nextScheduledAt: null,
          });
          deferred += 1;
          continue;
        }
        const timezone = job.config.timezone || job.mailbox.timezone || job.mailbox.workspace.timezone || 'UTC';
        const scheduleConfig = {
          timezone,
          weekdays: parseWeekdays(job.config.weekdays),
          windowStart: job.config.windowStart,
          windowEnd: job.config.windowEnd,
        };
        if (!isWithinWarmupWindow(now, scheduleConfig)) {
          const nextOpen = nextWindowOpen(now, scheduleConfig);
          await warmupJobService.markDeferred(job.id, {
            reason: 'OUTSIDE_SENDING_WINDOW',
            nextScheduledAt: nextOpen,
          });
          deferred += 1;
          continue;
        }
        const payload: WarmupQueuePayload = {
          warmupJobId: job.id,
          workspaceId: job.workspaceId,
          mailboxId: job.mailboxId,
        };
        const bullJob = await this.warmupQueue.add('warmup-send', payload, {
          jobId: `warmup-job-${job.id}`,
          removeOnComplete: 500,
          removeOnFail: 1000,
        });
        await warmupJobService.markDispatched(job.id, bullJob.id ?? null);
        dispatched += 1;
      } catch (error) {
        errors += 1;
        logWarmupEvent('Failed to dispatch warmup job', {
          workspaceId: job.workspaceId,
          mailboxId: job.mailboxId,
          jobId: job.id,
          status: 'dispatch_error',
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return { dispatched, deferred, errors };
  }

  async runTick(now: Date = new Date()): Promise<WarmupSchedulerTickResult> {
    const planned = await this.planDailyWarmupJobs(now);
    const ramp = await this.advanceDailyLimits(now);
    const dispatch = await this.dispatchDueWarmupJobs(now);
    return {
      planned: planned.planned,
      progressed: ramp.progressed,
      completed: ramp.completed,
      dispatched: dispatch.dispatched,
      deferred: dispatch.deferred,
      errors: dispatch.errors,
    };
  }
}

function nextWindowOpen(
  now: Date,
  config: { timezone: string; weekdays: number[]; windowStart: string; windowEnd: string },
): Date {
  const start = /^(\d{2}):(\d{2})$/.exec(config.windowStart);
  if (!start) return now;
  const hour = Number(start[1]);
  const minute = Number(start[2]);
  const local = DateTime.fromJSDate(now, { zone: config.timezone });
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = local.plus({ days: offset }).set({ hour, minute, second: 0, millisecond: 0 });
    const day = (candidate.weekday as number) % 7;
    if (!config.weekdays.includes(day)) continue;
    if (candidate > local) return candidate.toUTC().toJSDate();
  }
  return now;
}
