import { prisma } from '@signalforge/database';
import { calculateRates } from './metrics/formulas.js';
import { countersService } from './metrics/counters-service.js';
import { calculateHealthScore, serializeScoreBreakdown } from './health-score-service.js';
import { deliverabilityPolicyService } from './policy-service.js';
import { deliverabilityProtectionService } from './protection-service.js';
import { deliverabilityAlertService } from './alert-service.js';
import { velocityService } from './velocity-service.js';
import type { DeliveryCounters } from './types.js';

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + 86_399_999);
}

export interface AggregationResult {
  mailboxSnapshots: number;
  campaignSnapshots: number;
  alertsRaised: number;
}

/**
 * Rolls delivery events into daily per-mailbox and per-campaign snapshots so the
 * dashboard reads a handful of pre-aggregated rows instead of scanning the event
 * log. Snapshots are upserted on `[entity, date]`, making the job safe to re-run
 * for the same day.
 */
export class DeliverabilityAggregationService {
  async aggregateWorkspaceDay(workspaceId: string, day: Date): Promise<AggregationResult> {
    const from = startOfUtcDay(day);
    const to = endOfUtcDay(day);
    const { thresholds, weights } = await deliverabilityPolicyService.get(workspaceId);

    const [mailboxCounters, campaignCounters] = await Promise.all([
      countersService.getCountersByMailbox({ workspaceId, from, to }),
      countersService.getCountersByCampaign({ workspaceId, from, to }),
    ]);

    let mailboxSnapshots = 0;
    let alertsRaised = 0;

    for (const [mailboxId, counters] of mailboxCounters) {
      const mailbox = await prisma.mailbox.findFirst({
        where: { id: mailboxId, workspaceId },
        select: {
          id: true,
          emailAddress: true,
          warmupStatus: true,
          health: { select: { score: true, protectionLevel: true } },
        },
      });
      if (!mailbox) continue;

      const previousScore = mailbox.health?.score ?? null;
      const score = calculateHealthScore({ counters, weights, thresholds, warmupStatus: mailbox.warmupStatus });
      const rates = calculateRates(counters);

      await prisma.mailboxHealthSnapshot.upsert({
        where: { mailboxId_snapshotDate: { mailboxId, snapshotDate: from } },
        create: {
          workspaceId,
          mailboxId,
          snapshotDate: from,
          ...snapshotCounters(counters),
          bounceRate: rates.bounceRate,
          failureRate: rates.failureRate,
          replyRate: rates.replyRate,
          unsubscribeRate: rates.unsubscribeRate,
          healthScore: score.score,
          protectionLevel: score.protectionLevel,
          scoreBreakdown: serializeScoreBreakdown(score),
        },
        update: {
          ...snapshotCounters(counters),
          bounceRate: rates.bounceRate,
          failureRate: rates.failureRate,
          replyRate: rates.replyRate,
          unsubscribeRate: rates.unsubscribeRate,
          healthScore: score.score,
          protectionLevel: score.protectionLevel,
          scoreBreakdown: serializeScoreBreakdown(score),
        },
      });
      mailboxSnapshots += 1;

      const evaluation = await deliverabilityProtectionService.evaluateMailbox(workspaceId, mailboxId, to);
      if (evaluation) {
        alertsRaised += await deliverabilityAlertService.evaluateMailbox({
          workspaceId,
          mailboxId,
          mailboxLabel: mailbox.emailAddress,
          counters: evaluation.counters,
          thresholds,
          evaluation: evaluation.protection,
          healthScore: evaluation.score.score,
          previousHealthScore: previousScore,
          paused: evaluation.paused,
          occurredAt: to,
        });
      }

      const velocity = await velocityService.getMailboxVelocity(workspaceId, mailboxId, to);
      if (velocity.anomalyDetected && velocity.anomalyDescription) {
        alertsRaised += await deliverabilityAlertService.evaluateVelocity({
          workspaceId,
          mailboxId,
          mailboxLabel: mailbox.emailAddress,
          description: velocity.anomalyDescription,
          occurredAt: to,
        });
      }
    }

    let campaignSnapshots = 0;
    for (const [campaignId, counters] of campaignCounters) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId },
        select: { id: true },
      });
      if (!campaign) continue;

      const score = calculateHealthScore({ counters, weights, thresholds });
      const rates = calculateRates(counters);

      await prisma.campaignHealthSnapshot.upsert({
        where: { campaignId_snapshotDate: { campaignId, snapshotDate: from } },
        create: {
          workspaceId,
          campaignId,
          snapshotDate: from,
          ...snapshotCounters(counters),
          bounceRate: rates.bounceRate,
          failureRate: rates.failureRate,
          replyRate: rates.replyRate,
          unsubscribeRate: rates.unsubscribeRate,
          healthScore: score.score,
          scoreBreakdown: serializeScoreBreakdown(score),
        },
        update: {
          ...snapshotCounters(counters),
          bounceRate: rates.bounceRate,
          failureRate: rates.failureRate,
          replyRate: rates.replyRate,
          unsubscribeRate: rates.unsubscribeRate,
          healthScore: score.score,
          scoreBreakdown: serializeScoreBreakdown(score),
        },
      });
      campaignSnapshots += 1;
    }

    return { mailboxSnapshots, campaignSnapshots, alertsRaised };
  }

  /// Workspaces with delivery activity in the window, used by the scheduler to
  /// avoid enqueueing work for idle tenants.
  async findWorkspacesWithActivity(from: Date, to: Date): Promise<string[]> {
    const rows = await prisma.emailDeliveryEvent.groupBy({
      by: ['workspaceId'],
      where: { occurredAt: { gte: from, lte: to } },
    });
    return rows.map((row) => row.workspaceId);
  }
}

function snapshotCounters(counters: DeliveryCounters) {
  return {
    sent: counters.sent,
    delivered: counters.delivered,
    bounced: counters.bounced,
    hardBounces: counters.hardBounces,
    softBounces: counters.softBounces,
    failed: counters.failed,
    replies: counters.replies,
    unsubscribes: counters.unsubscribes,
    complaints: counters.complaints,
  };
}

export const deliverabilityAggregationService = new DeliverabilityAggregationService();
