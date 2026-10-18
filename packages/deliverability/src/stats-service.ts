import { prisma } from '@signalforge/database';
import { calculateRates, compareTrend, sumCounters, type TrendDirection } from './metrics/formulas.js';
import { countersService } from './metrics/counters-service.js';
import {
  HEALTH_SCORE_EXPLANATION,
  calculateHealthScore,
  classifyTier,
} from './health-score-service.js';
import { deliverabilityPolicyService } from './policy-service.js';
import { velocityService } from './velocity-service.js';
import { buildRecommendations, buildDomainRecommendations } from './recommendation-service.js';
import { domainHealthService } from './domain-health-service.js';
import { normalizeDomain } from './dns-checker.js';
import type {
  DeliverabilityProtectionLevel,
  DeliveryCounters,
  DeliveryRates,
  HealthScoreResult,
  HealthTier,
} from './types.js';

export interface TimeRange {
  from: Date;
  to: Date;
}

export function resolveRange(period: string, now = new Date()): TimeRange {
  const to = now;
  switch (period) {
    case 'today':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), to };
    case '30d':
      return { from: new Date(now.getTime() - 30 * 86_400_000), to };
    case '7d':
    default:
      return { from: new Date(now.getTime() - 7 * 86_400_000), to };
  }
}

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  direction: TrendDirection;
}

export interface DeliverabilityOverview {
  range: { from: string; to: string };
  healthScore: number;
  tier: HealthTier;
  scoreExplanation: string;
  components: HealthScoreResult['components'];
  counters: DeliveryCounters;
  rates: DeliveryRates;
  trends: {
    bounceRate: MetricTrend;
    replyRate: MetricTrend;
    failureRate: MetricTrend;
    unsubscribeRate: MetricTrend;
    sent: MetricTrend;
  };
  mailboxSummary: {
    total: number;
    healthy: number;
    needsAttention: number;
    atRisk: number;
    critical: number;
    paused: number;
  };
  complaintDataAvailable: boolean;
  recommendations: string[];
}

export interface MailboxHealthRow {
  mailboxId: string;
  emailAddress: string;
  status: string;
  healthStatus: string;
  healthScore: number;
  tier: HealthTier;
  protectionLevel: DeliverabilityProtectionLevel;
  protectionReason: string | null;
  warmupStatus: string;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export class DeliverabilityStatsService {
  async getOverview(workspaceId: string, range: TimeRange): Promise<DeliverabilityOverview> {
    const { thresholds, weights } = await deliverabilityPolicyService.get(workspaceId);
    const windowMs = range.to.getTime() - range.from.getTime();
    const previousRange: TimeRange = {
      from: new Date(range.from.getTime() - windowMs),
      to: range.from,
    };

    const [counters, previousCounters, mailboxes] = await Promise.all([
      countersService.getCounters({ workspaceId, from: range.from, to: range.to }),
      countersService.getCounters({ workspaceId, from: previousRange.from, to: previousRange.to }),
      prisma.mailbox.findMany({
        where: { workspaceId },
        select: {
          id: true,
          status: true,
          healthStatus: true,
          health: { select: { score: true, protectionLevel: true } },
        },
      }),
    ]);

    const rates = calculateRates(counters);
    const previousRates = calculateRates(previousCounters);
    const score = calculateHealthScore({ counters, weights, thresholds });

    const summary = {
      total: mailboxes.length,
      healthy: 0,
      needsAttention: 0,
      atRisk: 0,
      critical: 0,
      paused: mailboxes.filter((mailbox) => mailbox.status === 'DISABLED').length,
    };
    for (const mailbox of mailboxes) {
      const level = mailbox.health?.protectionLevel ?? 'NORMAL';
      if (level === 'CRITICAL') summary.critical += 1;
      else if (level === 'AT_RISK') summary.atRisk += 1;
      else if (level === 'WARNING') summary.needsAttention += 1;
      else summary.healthy += 1;
    }

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      healthScore: score.score,
      tier: score.tier,
      scoreExplanation: HEALTH_SCORE_EXPLANATION,
      components: score.components,
      counters,
      rates,
      trends: {
        bounceRate: buildTrend(rates.bounceRate, previousRates.bounceRate, true),
        replyRate: buildTrend(rates.replyRate, previousRates.replyRate, false),
        failureRate: buildTrend(rates.failureRate, previousRates.failureRate, true),
        unsubscribeRate: buildTrend(rates.unsubscribeRate, previousRates.unsubscribeRate, true),
        sent: buildTrend(counters.sent, previousCounters.sent, false),
      },
      mailboxSummary: summary,
      complaintDataAvailable: counters.complaintDataAvailable,
      recommendations: buildRecommendations({
        counters,
        rates,
        level: score.protectionLevel,
      }),
    };
  }

  async getMailboxRows(workspaceId: string, range: TimeRange): Promise<MailboxHealthRow[]> {
    const { thresholds } = await deliverabilityPolicyService.get(workspaceId);
    const [mailboxes, countersByMailbox] = await Promise.all([
      prisma.mailbox.findMany({
        where: { workspaceId },
        select: {
          id: true,
          emailAddress: true,
          status: true,
          healthStatus: true,
          warmupStatus: true,
          health: { select: { score: true, protectionLevel: true, protectionReason: true } },
        },
        orderBy: { emailAddress: 'asc' },
      }),
      countersService.getCountersByMailbox({ workspaceId, from: range.from, to: range.to }),
    ]);

    return mailboxes.map((mailbox) => {
      const counters = countersByMailbox.get(mailbox.id) ?? sumCounters([]);
      const healthScore = mailbox.health?.score ?? 100;
      return {
        mailboxId: mailbox.id,
        emailAddress: mailbox.emailAddress,
        status: mailbox.status,
        healthStatus: mailbox.healthStatus,
        healthScore,
        tier: classifyTier(healthScore, thresholds),
        protectionLevel: mailbox.health?.protectionLevel ?? 'NORMAL',
        protectionReason: mailbox.health?.protectionReason ?? null,
        warmupStatus: mailbox.warmupStatus,
        counters,
        rates: calculateRates(counters),
      };
    });
  }

  async getMailboxDetail(workspaceId: string, mailboxId: string, range: TimeRange) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      select: {
        id: true,
        emailAddress: true,
        status: true,
        healthStatus: true,
        warmupStatus: true,
        dailySendingLimit: true,
        lastErrorAt: true,
        lastErrorMessage: true,
        health: {
          select: {
            score: true,
            protectionLevel: true,
            protectionReason: true,
            protectionUpdatedAt: true,
            hardBounceCount: true,
            softBounceCount: true,
            scoreBreakdown: true,
            lastCheckedAt: true,
          },
        },
      },
    });
    if (!mailbox) return null;

    const { thresholds, weights } = await deliverabilityPolicyService.get(workspaceId);
    const [counters, velocity, domain] = await Promise.all([
      countersService.getCounters({ workspaceId, mailboxId, from: range.from, to: range.to }),
      velocityService.getMailboxVelocity(workspaceId, mailboxId),
      domainHealthService.get(workspaceId, normalizeDomain(mailbox.emailAddress)),
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
    const rates = calculateRates(counters);

    return {
      mailbox: {
        id: mailbox.id,
        emailAddress: mailbox.emailAddress,
        status: mailbox.status,
        healthStatus: mailbox.healthStatus,
        warmupStatus: mailbox.warmupStatus,
        dailySendingLimit: mailbox.dailySendingLimit,
        lastErrorAt: mailbox.lastErrorAt,
        lastErrorMessage: mailbox.lastErrorMessage,
        protectionLevel: mailbox.health?.protectionLevel ?? 'NORMAL',
        protectionReason: mailbox.health?.protectionReason ?? null,
        protectionUpdatedAt: mailbox.health?.protectionUpdatedAt ?? null,
      },
      healthScore: score.score,
      tier: score.tier,
      scoreExplanation: HEALTH_SCORE_EXPLANATION,
      components: score.components,
      counters,
      rates,
      velocity,
      domain: domain
        ? {
            domain: domain.domain,
            spfStatus: domain.spfStatus,
            dkimStatus: domain.dkimStatus,
            dmarcStatus: domain.dmarcStatus,
            mxStatus: domain.mxStatus,
            dmarcPolicy: domain.dmarcPolicy,
            checkedAt: domain.checkedAt,
            recommendations: buildDomainRecommendations(domain),
          }
        : null,
      complaintDataAvailable: counters.complaintDataAvailable,
      recommendations: buildRecommendations({ counters, rates, level: score.protectionLevel }),
    };
  }

  async getMailboxTimeline(workspaceId: string, mailboxId: string, range: TimeRange) {
    return prisma.mailboxHealthSnapshot.findMany({
      where: {
        workspaceId,
        mailboxId,
        snapshotDate: { gte: startOfDay(range.from), lte: range.to },
      },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async getWorkspaceTimeline(workspaceId: string, range: TimeRange) {
    const rows = await prisma.mailboxHealthSnapshot.groupBy({
      by: ['snapshotDate'],
      where: { workspaceId, snapshotDate: { gte: startOfDay(range.from), lte: range.to } },
      _sum: {
        sent: true,
        delivered: true,
        bounced: true,
        failed: true,
        replies: true,
        unsubscribes: true,
      },
      _avg: { healthScore: true },
      orderBy: { snapshotDate: 'asc' },
    });

    return rows.map((row) => {
      const sent = row._sum.sent ?? 0;
      const bounced = row._sum.bounced ?? 0;
      const failed = row._sum.failed ?? 0;
      const attempted = sent + bounced + failed;
      const counters = {
        ...sumCounters([]),
        attempted,
        sent,
        delivered: row._sum.delivered ?? 0,
        bounced,
        failed,
        replies: row._sum.replies ?? 0,
        uniqueRepliedLeads: row._sum.replies ?? 0,
        unsubscribes: row._sum.unsubscribes ?? 0,
      };
      const rates = calculateRates(counters);
      return {
        date: row.snapshotDate.toISOString().slice(0, 10),
        sent,
        bounced,
        failed,
        replies: counters.replies,
        unsubscribes: counters.unsubscribes,
        bounceRate: rates.bounceRate,
        failureRate: rates.failureRate,
        replyRate: rates.replyRate,
        unsubscribeRate: rates.unsubscribeRate,
        healthScore: Math.round(row._avg.healthScore ?? 100),
      };
    });
  }

  async getCampaignRows(workspaceId: string, range: TimeRange) {
    const { thresholds, weights } = await deliverabilityPolicyService.get(workspaceId);
    const countersByCampaign = await countersService.getCountersByCampaign({
      workspaceId,
      from: range.from,
      to: range.to,
    });
    const campaignIds = [...countersByCampaign.keys()];
    if (campaignIds.length === 0) return [];

    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId, id: { in: campaignIds } },
      select: { id: true, name: true, status: true },
    });

    return campaigns
      .map((campaign) => {
        const counters = countersByCampaign.get(campaign.id) ?? sumCounters([]);
        const score = calculateHealthScore({ counters, weights, thresholds });
        return {
          campaignId: campaign.id,
          name: campaign.name,
          status: campaign.status,
          healthScore: score.score,
          tier: score.tier,
          counters,
          rates: calculateRates(counters),
        };
      })
      .sort((a, b) => a.healthScore - b.healthScore);
  }

  async getCampaignDetail(workspaceId: string, campaignId: string, range: TimeRange) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      select: { id: true, name: true, status: true },
    });
    if (!campaign) return null;

    const { thresholds, weights } = await deliverabilityPolicyService.get(workspaceId);
    const counters = await countersService.getCounters({
      workspaceId,
      campaignId,
      from: range.from,
      to: range.to,
    });
    const score = calculateHealthScore({ counters, weights, thresholds });
    const rates = calculateRates(counters);

    const timeline = await prisma.campaignHealthSnapshot.findMany({
      where: { workspaceId, campaignId, snapshotDate: { gte: startOfDay(range.from), lte: range.to } },
      orderBy: { snapshotDate: 'asc' },
    });

    return {
      campaign,
      healthScore: score.score,
      tier: score.tier,
      scoreExplanation: HEALTH_SCORE_EXPLANATION,
      components: score.components,
      counters,
      rates,
      timeline,
      complaintDataAvailable: counters.complaintDataAvailable,
      recommendations: buildRecommendations({ counters, rates, level: score.protectionLevel }),
    };
  }

  /// Combined period report used by the report view and the CSV export.
  async getReport(workspaceId: string, range: TimeRange) {
    const [overview, mailboxes, campaigns, openAlerts, domains] = await Promise.all([
      this.getOverview(workspaceId, range),
      this.getMailboxRows(workspaceId, range),
      this.getCampaignRows(workspaceId, range),
      prisma.deliverabilityAlert.findMany({
        where: { workspaceId, status: 'OPEN' },
        orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
        take: 20,
      }),
      domainHealthService.list(workspaceId),
    ]);

    const issues: string[] = [];
    for (const alert of openAlerts) {
      issues.push(`${alert.title}${alert.entityLabel ? ` — ${alert.entityLabel}` : ''}`);
    }
    for (const domain of domains) {
      if (domain.dkimStatus === 'UNKNOWN' || domain.dmarcStatus === 'UNKNOWN') {
        issues.push(`Authentication check incomplete for ${domain.domain}`);
      }
    }

    const recommendations = new Set(overview.recommendations);
    for (const domain of domains) {
      for (const recommendation of buildDomainRecommendations(domain)) {
        recommendations.add(recommendation);
      }
    }

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      overview,
      mailboxes,
      campaigns,
      issues,
      recommendations: [...recommendations],
    };
  }
}

function buildTrend(current: number, previous: number, lowerIsBetter: boolean): MetricTrend {
  const { direction, delta } = compareTrend(current, previous, lowerIsBetter);
  return { current, previous, delta, direction };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const deliverabilityStatsService = new DeliverabilityStatsService();
