import { prisma } from '@signalforge/database';
import { sendingLimitService } from '@signalforge/sending';
import { computeUsageDate } from '@signalforge/mailboxes';
import { logAllocation } from './activity.js';
import {
  resolveCampaignCandidates,
  CampaignNotFoundError,
  InvalidSmtpConfigurationError,
} from './campaign-resolver.js';
import { filterEligibleAccounts } from './eligibility.js';
import {
  reserveCapacity,
  releaseReservation,
  CapacityExhaustedError,
  ReservationConflictError,
} from './reservation.js';
import { getStrategy } from './strategies/index.js';
import type {
  AllocationResult,
  DegradedMailboxPolicy,
  RotationStrategy,
} from './types.js';

export interface AllocateAccountInput {
  jobId: string;
  workspaceId: string;
}

const MAX_STRATEGY_RETRIES = 5;

async function loadSendingPolicy(workspaceId: string): Promise<{
  enabled: boolean;
  rotationStrategy: RotationStrategy;
  degradedPolicy: DegradedMailboxPolicy;
}> {
  const policy = await prisma.sendingPolicy.findUnique({ where: { workspaceId } });
  return {
    enabled: policy?.enabled ?? true,
    rotationStrategy: (policy?.rotationStrategy as RotationStrategy | undefined) ?? 'ROUND_ROBIN',
    degradedPolicy: (policy?.degradedMailboxPolicy as DegradedMailboxPolicy | undefined) ?? 'ALLOW',
  };
}

function pickStrategy(
  campaignStrategy: RotationStrategy,
  poolStrategy: string | null,
  workspaceStrategy: RotationStrategy,
): RotationStrategy {
  if (poolStrategy) return poolStrategy as RotationStrategy;
  return campaignStrategy ?? workspaceStrategy;
}

async function updateJobMailbox(jobId: string, mailboxId: string): Promise<void> {
  await prisma.sendingJob.update({
    where: { id: jobId },
    data: { mailboxId },
  });
}

export class AllocationService {
  async allocateAccount(input: AllocateAccountInput): Promise<AllocationResult> {
    const job = await prisma.sendingJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId },
    });
    if (!job) {
      return { status: 'FAILED', outcome: 'INVALID_SMTP_CONFIGURATION', reason: 'Job not found', retryable: false };
    }

    // Idempotency: an active reservation trumps re-allocation.
    const existingReservation = await prisma.mailboxCapacityReservation.findUnique({
      where: { sendingJobId: input.jobId },
    });
    if (existingReservation && existingReservation.status !== 'RELEASED') {
      if (job.mailboxId !== existingReservation.mailboxId) {
        await updateJobMailbox(input.jobId, existingReservation.mailboxId);
      }
      await logAllocation({
        workspaceId: input.workspaceId,
        sendingJobId: input.jobId,
        campaignId: job.campaignId,
        mailboxId: existingReservation.mailboxId,
        poolId: existingReservation.poolId,
        strategy: existingReservation.strategy as RotationStrategy,
        outcome: 'IDEMPOTENT_HIT',
      });
      return {
        status: 'IDEMPOTENT',
        mailboxId: existingReservation.mailboxId,
        reservationId: existingReservation.id,
        strategy: existingReservation.strategy as RotationStrategy,
        poolId: existingReservation.poolId,
      };
    }

    const workspacePolicy = await loadSendingPolicy(input.workspaceId);

    const campaignLimit = await sendingLimitService.checkCampaignDailyLimit(job.campaignId);
    if (campaignLimit?.exhausted) {
      await logAllocation({
        workspaceId: input.workspaceId,
        sendingJobId: input.jobId,
        campaignId: job.campaignId,
        mailboxId: null,
        poolId: null,
        strategy: workspacePolicy.rotationStrategy,
        outcome: 'CAMPAIGN_LIMIT_REACHED',
        reason: `Sent ${campaignLimit.sentToday}/${campaignLimit.dailyLimit ?? '∞'}`,
      });
      return {
        status: 'FAILED',
        outcome: 'CAMPAIGN_LIMIT_REACHED',
        reason: 'Campaign daily limit reached',
        retryable: true,
      };
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: job.campaignId },
      include: { workspace: true },
    });
    if (!campaign) {
      return { status: 'FAILED', outcome: 'INVALID_SMTP_CONFIGURATION', reason: 'Campaign not found', retryable: false };
    }

    const timezone = campaign.workspace.timezone ?? 'UTC';
    const usageDateStr = computeUsageDate(new Date(), timezone);
    const usageDate = new Date(`${usageDateStr}T00:00:00.000Z`);

    let resolved;
    try {
      resolved = await resolveCampaignCandidates(job.campaignId, input.workspaceId, usageDate);
    } catch (error) {
      if (error instanceof InvalidSmtpConfigurationError || error instanceof CampaignNotFoundError) {
        await logAllocation({
          workspaceId: input.workspaceId,
          sendingJobId: input.jobId,
          campaignId: job.campaignId,
          mailboxId: null,
          poolId: null,
          strategy: workspacePolicy.rotationStrategy,
          outcome: 'INVALID_SMTP_CONFIGURATION',
          reason: error.message,
        });
        return { status: 'FAILED', outcome: 'INVALID_SMTP_CONFIGURATION', reason: error.message, retryable: false };
      }
      throw error;
    }

    if (resolved.sendingMode === 'SMTP_POOL' && !resolved.poolEnabled) {
      await logAllocation({
        workspaceId: input.workspaceId,
        sendingJobId: input.jobId,
        campaignId: job.campaignId,
        mailboxId: null,
        poolId: resolved.poolId,
        strategy: workspacePolicy.rotationStrategy,
        outcome: 'SMTP_POOL_DISABLED',
        reason: 'Pool is disabled',
      });
      return { status: 'FAILED', outcome: 'SMTP_POOL_DISABLED', reason: 'Pool is disabled', retryable: true };
    }

    const strategyName = pickStrategy(
      resolved.rotationStrategy as RotationStrategy,
      resolved.poolStrategy,
      workspacePolicy.rotationStrategy,
    );
    const strategy = getStrategy(strategyName);

    const { eligible, rejected } = filterEligibleAccounts(
      resolved.candidates,
      workspacePolicy.degradedPolicy,
    );

    if (eligible.length === 0) {
      const reason = rejected.length > 0
        ? `No eligible accounts (${rejected.map((r) => r.reason).join(', ')})`
        : 'No eligible accounts';
      await logAllocation({
        workspaceId: input.workspaceId,
        sendingJobId: input.jobId,
        campaignId: job.campaignId,
        mailboxId: null,
        poolId: resolved.poolId,
        strategy: strategyName,
        outcome: 'NO_ELIGIBLE_ACCOUNTS',
        reason,
      });
      return { status: 'FAILED', outcome: 'NO_ELIGIBLE_ACCOUNTS', reason, retryable: true };
    }

    let lastRoundRobin: string | null = null;
    if (resolved.poolId && strategyName === 'ROUND_ROBIN') {
      const pool = await prisma.smtpPool.findUnique({ where: { id: resolved.poolId } });
      lastRoundRobin = pool?.lastRoundRobinMailboxId ?? null;
    }

    // Attempt selection + reservation with a small retry loop to survive
    // concurrent allocators competing for the same last capacity slot.
    const attempted = new Set<string>();
    let candidates = [...eligible];
    let attempt = 0;

    while (candidates.length > 0 && attempt < MAX_STRATEGY_RETRIES) {
      attempt += 1;
      const pick = strategy.select(candidates, {
        now: new Date(),
        lastRoundRobinMailboxId: lastRoundRobin,
        degradedPolicy: workspacePolicy.degradedPolicy,
      });
      if (!pick) break;
      attempted.add(pick.mailboxId);

      try {
        const reservation = await reserveCapacity({
          workspaceId: input.workspaceId,
          sendingJobId: input.jobId,
          mailboxId: pick.mailboxId,
          poolId: resolved.poolId,
          usageDate: usageDateStr,
          dailyLimit: pick.dailyLimit,
          strategy: strategyName,
        });

        await updateJobMailbox(input.jobId, pick.mailboxId);

        if (resolved.poolId && strategyName === 'ROUND_ROBIN') {
          await prisma.smtpPool.update({
            where: { id: resolved.poolId },
            data: { lastRoundRobinMailboxId: pick.mailboxId },
          });
        }

        await logAllocation({
          workspaceId: input.workspaceId,
          sendingJobId: input.jobId,
          campaignId: job.campaignId,
          mailboxId: pick.mailboxId,
          poolId: resolved.poolId,
          strategy: strategyName,
          outcome: 'ALLOCATED',
        });

        return {
          status: 'ALLOCATED',
          mailboxId: pick.mailboxId,
          reservationId: reservation.reservationId,
          strategy: strategyName,
          poolId: resolved.poolId,
        };
      } catch (error) {
        if (error instanceof CapacityExhaustedError || error instanceof ReservationConflictError) {
          candidates = candidates.filter((c) => !attempted.has(c.mailboxId));
          continue;
        }
        throw error;
      }
    }

    await logAllocation({
      workspaceId: input.workspaceId,
      sendingJobId: input.jobId,
      campaignId: job.campaignId,
      mailboxId: null,
      poolId: resolved.poolId,
      strategy: strategyName,
      outcome: 'ALLOCATION_CONFLICT',
      reason: 'Exhausted retry budget for concurrent reservation attempts',
    });
    return {
      status: 'FAILED',
      outcome: 'ALLOCATION_CONFLICT',
      reason: 'Could not reserve capacity within retry budget',
      retryable: true,
    };
  }

  async reallocateAccount(input: AllocateAccountInput, reason: string): Promise<AllocationResult> {
    const existing = await prisma.mailboxCapacityReservation.findUnique({
      where: { sendingJobId: input.jobId },
    });
    if (existing && existing.status === 'RESERVED') {
      await releaseReservation({ reservationId: existing.id, reason });
    }
    await prisma.sendingJob.update({
      where: { id: input.jobId },
      data: { mailboxId: null },
    });
    return this.allocateAccount(input);
  }
}

export const allocationService = new AllocationService();
