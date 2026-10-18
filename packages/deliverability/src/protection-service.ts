import { prisma } from '@signalforge/database';
import { calculateRates } from './metrics/formulas.js';
import { countersService } from './metrics/counters-service.js';
import {
  calculateHealthScore,
  serializeScoreBreakdown,
  tierToHealthStatus,
} from './health-score-service.js';
import { deliverabilityPolicyService } from './policy-service.js';
import { domainHealthService } from './domain-health-service.js';
import { velocityService } from './velocity-service.js';
import { buildRecommendations } from './recommendation-service.js';
import { normalizeDomain } from './dns-checker.js';
import type {
  DeliverabilityProtection,
  DeliverabilityProtectionLevel,
  DeliverabilityThresholds,
  DeliveryCounters,
  HealthScoreResult,
  ProtectionEvaluation,
} from './types.js';

const EVALUATION_WINDOW_DAYS = 7;

/**
 * Decides whether a mailbox's measured signals warrant restricting sending.
 *
 * Deterministic by design: rate thresholds drive protection level, and only an
 * explicit policy toggle can pause a mailbox. AI never participates in this path.
 */
export function evaluateProtectionLevel(
  counters: DeliveryCounters,
  score: HealthScoreResult,
  thresholds: DeliverabilityThresholds,
  protection: DeliverabilityProtection,
): ProtectionEvaluation {
  const rates = calculateRates(counters);
  const hasVolume = counters.attempted >= thresholds.minimumVolumeForRates;
  const reasons: string[] = [];
  let level: DeliverabilityProtectionLevel = score.protectionLevel;

  // Each signal records its own reason whenever it crosses a threshold, so a
  // restricted mailbox always shows why — even when the score alone had already
  // moved it off NORMAL.
  const escalate = (target: DeliverabilityProtectionLevel, reason: string) => {
    reasons.push(reason);
    if (target === 'CRITICAL' || level === 'NORMAL') level = target;
  };

  if (hasVolume) {
    if (rates.bounceRate >= thresholds.criticalBounceRatePercent) {
      escalate(
        'CRITICAL',
        `Bounce rate ${rates.bounceRate}% is at or above the critical threshold of ${thresholds.criticalBounceRatePercent}%.`,
      );
    } else if (rates.bounceRate >= thresholds.warningBounceRatePercent) {
      escalate('WARNING', `Bounce rate ${rates.bounceRate}% is elevated.`);
    }

    if (rates.failureRate >= thresholds.criticalFailureRatePercent) {
      escalate(
        'CRITICAL',
        `Send failure rate ${rates.failureRate}% is at or above the critical threshold of ${thresholds.criticalFailureRatePercent}%.`,
      );
    } else if (rates.failureRate >= thresholds.warningFailureRatePercent) {
      escalate('WARNING', `Send failure rate ${rates.failureRate}% is elevated.`);
    }

    if (rates.unsubscribeRate >= thresholds.warningUnsubscribeRatePercent) {
      escalate('WARNING', `Unsubscribe rate ${rates.unsubscribeRate}% is elevated.`);
    }
  }

  return {
    level,
    reason: reasons.length > 0 ? reasons.join(' ') : null,
    shouldPauseMailbox: level === 'CRITICAL' && protection.pauseOnCriticalBounceRate,
    recommendations: buildRecommendations({ counters, rates, level }),
  };
}

export interface MailboxEvaluation {
  mailboxId: string;
  score: HealthScoreResult;
  counters: DeliveryCounters;
  protection: ProtectionEvaluation;
  paused: boolean;
}

export class DeliverabilityProtectionService {
  /**
   * Recomputes a mailbox's health score and protection state, persisting both to
   * `MailboxHealth`. Pausing a mailbox always records a `MailboxActivity` entry
   * so the change is never silent.
   */
  async evaluateMailbox(
    workspaceId: string,
    mailboxId: string,
    now = new Date(),
  ): Promise<MailboxEvaluation | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      select: {
        id: true,
        emailAddress: true,
        status: true,
        warmupStatus: true,
        health: { select: { protectionLevel: true } },
      },
    });
    if (!mailbox) return null;

    const { thresholds, weights, protection } = await deliverabilityPolicyService.get(workspaceId);
    const from = new Date(now.getTime() - EVALUATION_WINDOW_DAYS * 86_400_000);
    const counters = await countersService.getCounters({ workspaceId, mailboxId, from, to: now });

    const [domain, velocity] = await Promise.all([
      domainHealthService.get(workspaceId, normalizeDomain(mailbox.emailAddress)),
      velocityService.getMailboxVelocity(workspaceId, mailboxId, now),
    ]);

    const score = calculateHealthScore({
      counters,
      weights,
      thresholds,
      dns: domain
        ? {
            spfStatus: domain.spfStatus,
            dkimStatus: domain.dkimStatus,
            dmarcStatus: domain.dmarcStatus,
            mxStatus: domain.mxStatus,
          }
        : null,
      warmupStatus: mailbox.warmupStatus,
      velocityAnomaly: velocity.anomalyDetected,
    });

    const evaluation = evaluateProtectionLevel(counters, score, thresholds, protection);
    const previousLevel = mailbox.health?.protectionLevel ?? 'NORMAL';

    await prisma.mailboxHealth.upsert({
      where: { mailboxId },
      create: {
        mailboxId,
        score: score.score,
        protectionLevel: evaluation.level,
        protectionReason: evaluation.reason,
        protectionUpdatedAt: evaluation.level === previousLevel ? undefined : now,
        hardBounceCount: counters.hardBounces,
        softBounceCount: counters.softBounces,
        scoreBreakdown: serializeScoreBreakdown(score),
        lastCheckedAt: now,
      },
      update: {
        score: score.score,
        protectionLevel: evaluation.level,
        protectionReason: evaluation.reason,
        ...(evaluation.level === previousLevel ? {} : { protectionUpdatedAt: now }),
        hardBounceCount: counters.hardBounces,
        softBounceCount: counters.softBounces,
        scoreBreakdown: serializeScoreBreakdown(score),
        lastCheckedAt: now,
      },
    });

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { healthStatus: tierToHealthStatus(score.tier) },
    });

    let paused = false;
    if (evaluation.shouldPauseMailbox && mailbox.status !== 'DISABLED') {
      await prisma.$transaction([
        prisma.mailbox.update({ where: { id: mailboxId }, data: { status: 'DISABLED' } }),
        prisma.mailboxActivity.create({
          data: {
            mailboxId,
            workspaceId,
            type: 'PROTECTION_PAUSED',
            summary: 'Sending paused by deliverability protection.',
            metadata: {
              reason: evaluation.reason,
              healthScore: score.score,
              protectionLevel: evaluation.level,
            },
          },
        }),
      ]);
      paused = true;
    }

    return { mailboxId, score, counters, protection: evaluation, paused };
  }

  /**
   * Clears a protection pause after an operator review. This only re-enables the
   * mailbox; recipient suppressions from hard bounces are untouched and continue
   * to block sends.
   */
  async resumeMailbox(input: {
    workspaceId: string;
    mailboxId: string;
    actorUserId: string;
    note?: string;
  }): Promise<{ resumed: boolean }> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: input.mailboxId, workspaceId: input.workspaceId },
      select: { id: true, status: true },
    });
    if (!mailbox) return { resumed: false };

    await prisma.$transaction([
      prisma.mailbox.update({
        where: { id: input.mailboxId },
        data: { status: 'ACTIVE' },
      }),
      prisma.mailboxHealth.upsert({
        where: { mailboxId: input.mailboxId },
        create: {
          mailboxId: input.mailboxId,
          protectionLevel: 'WARNING',
          protectionReason: 'Manually resumed after review.',
          protectionUpdatedAt: new Date(),
        },
        update: {
          protectionLevel: 'WARNING',
          protectionReason: 'Manually resumed after review.',
          protectionUpdatedAt: new Date(),
        },
      }),
      prisma.mailboxActivity.create({
        data: {
          mailboxId: input.mailboxId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          type: 'PROTECTION_RESUMED',
          summary: 'Sending resumed after manual deliverability review.',
          metadata: { note: input.note ?? null },
        },
      }),
    ]);

    return { resumed: true };
  }
}

export const deliverabilityProtectionService = new DeliverabilityProtectionService();
