import type { Queue } from 'bullmq';
import { prisma } from '@signalforge/database';
import { deliverabilitySendGate } from '@signalforge/deliverability';
import type { ScheduleConfig } from '@signalforge/campaigns';
import { calculateNextValidSlot, isWithinSendingWindow } from './schedule-calculator.js';
import { logSendingEvent } from './activity.js';
import { evaluateSendingEligibility } from './eligibility-rules.js';
import { sendingJobService } from './job-service.js';
import type { SendingJobEligibilityReason, SendingJobPayload } from './types.js';

const DISPATCH_BATCH = 100;
const MISSED_THRESHOLD_MS = 5 * 60 * 1000;
/// How long to hold a job when a mailbox is temporarily protected. The block is
/// expected to clear once health recovers, so the job is deferred rather than
/// cancelled.
const PROTECTION_DEFER_MS = 60 * 60_000;

/// Deliverability blocks that can clear on their own, as opposed to a
/// suppression which is permanent.
const RECOVERABLE_BLOCKS: ReadonlySet<SendingJobEligibilityReason> = new Set([
  'MAILBOX_CRITICAL_HEALTH',
  'MAILBOX_PAUSED',
  'RECIPIENT_SOFT_BOUNCE_AT_RISK',
]);

export interface SchedulerDispatchResult {
  dispatched: number;
  deferred: number;
  errors: number;
}

export class SendingSchedulerService {
  constructor(private readonly emailSendQueue: Queue<SendingJobPayload>) {}

  async dispatchDueJobs(now: Date = new Date(), limit: number = DISPATCH_BATCH): Promise<SchedulerDispatchResult> {
    const dueJobs = await prisma.sendingJob.findMany({
      where: {
        status: { in: ['SCHEDULED', 'RETRYING'] },
        scheduledAt: { lte: now },
      },
      orderBy: [{ scheduledAt: 'asc' }, { priority: 'desc' }],
      take: limit,
      include: {
        campaign: { select: { status: true, scheduleConfig: true } },
        campaignLead: { select: { status: true } },
        lead: { select: { email: true, status: true } },
      },
    });

    let dispatched = 0;
    let deferred = 0;
    let errors = 0;

    for (const job of dueJobs) {
      try {
        if (job.campaign.status !== 'ACTIVE') {
          continue;
        }

        const gate = await deliverabilitySendGate.check({
          workspaceId: job.workspaceId,
          mailboxId: job.mailboxId,
          email: job.lead.email,
        });

        const eligibility = evaluateSendingEligibility({
          campaign: { status: job.campaign.status },
          campaignLead: { status: job.campaignLead.status },
          lead: { email: job.lead.email, status: job.lead.status },
          deliverabilityBlock: gate.allowed ? null : gate.reason,
        });
        if (!eligibility.eligible) {
          if (eligibility.reason === 'INVALID_EMAIL') {
            await sendingJobService.markFailed(job.id, {
              errorCategory: 'INVALID_ADDRESS',
              message: eligibility.message,
            });
          } else if (RECOVERABLE_BLOCKS.has(eligibility.reason)) {
            await sendingJobService.rescheduleForWindow(
              job.id,
              calculateNextValidSlot(
                new Date(now.getTime() + PROTECTION_DEFER_MS),
                (job.campaign.scheduleConfig ?? {}) as ScheduleConfig,
              ),
            );
            deferred += 1;
          } else {
            await prisma.sendingJob.update({
              where: { id: job.id },
              data: { status: 'CANCELLED', cancelledAt: new Date() },
            });
          }
          continue;
        }

        const scheduleConfig = (job.campaign.scheduleConfig ?? {}) as ScheduleConfig;
        if (!isWithinSendingWindow(now, scheduleConfig)) {
          const next = calculateNextValidSlot(now, scheduleConfig);
          await sendingJobService.rescheduleForWindow(job.id, next);
          deferred += 1;
          continue;
        }

        const payload: SendingJobPayload = {
          sendingJobId: job.id,
          workspaceId: job.workspaceId,
          campaignId: job.campaignId,
          campaignLeadId: job.campaignLeadId,
          leadId: job.leadId,
          stepId: job.sequenceStepId,
        };

        const bullJob = await this.emailSendQueue.add('send', payload, {
          jobId: `sending-job-${job.id}`,
          removeOnComplete: 500,
          removeOnFail: 1000,
        });

        if (job.bullmqJobId !== bullJob.id) {
          await prisma.sendingJob.update({
            where: { id: job.id },
            data: { bullmqJobId: bullJob.id ?? null },
          });
        }

        dispatched += 1;
      } catch (error) {
        errors += 1;
        logSendingEvent('Failed to dispatch sending job', {
          workspaceId: job.workspaceId,
          campaignId: job.campaignId,
          jobId: job.id,
          error: error instanceof Error ? error.message : 'unknown',
          status: 'dispatch_error',
        });
      }
    }

    return { dispatched, deferred, errors };
  }

  async promoteScheduledCampaigns(now: Date = new Date()): Promise<number> {
    const campaigns = await prisma.campaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: { id: true, workspaceId: true },
    });
    let promoted = 0;
    for (const c of campaigns) {
      await prisma.campaign.update({
        where: { id: c.id },
        data: { status: 'ACTIVE', launchedAt: now },
      });
      await sendingJobService.bootstrapCampaign(c.id, c.workspaceId);
      promoted += 1;
    }
    return promoted;
  }

  async recoverMissedJobs(now: Date = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - MISSED_THRESHOLD_MS);
    const missed = await prisma.sendingJob.findMany({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: threshold },
      },
      take: 100,
    });
    let recovered = 0;
    for (const job of missed) {
      const campaign = await prisma.campaign.findUnique({ where: { id: job.campaignId } });
      const scheduleConfig = (campaign?.scheduleConfig ?? {}) as ScheduleConfig;
      const nextSlot = calculateNextValidSlot(now, scheduleConfig);
      await prisma.sendingJob.update({
        where: { id: job.id },
        data: { status: 'SCHEDULED', scheduledAt: nextSlot, claimedAt: null },
      });
      recovered += 1;
    }
    if (recovered > 0) {
      logSendingEvent('Recovered stuck sending jobs', {
        status: 'recovered',
        durationMs: 0,
        retryCount: recovered,
      });
    }
    return recovered;
  }

}
