import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import { calculateRates } from './metrics/formulas.js';
import type {
  DeliverabilityAlertSeverity,
  DeliverabilityAlertType,
  DeliverabilityEntityType,
  DeliverabilityThresholds,
  DeliveryCounters,
  DomainAuthResult,
  ProtectionEvaluation,
} from './types.js';

export interface RaiseAlertInput {
  workspaceId: string;
  severity: DeliverabilityAlertSeverity;
  alertType: DeliverabilityAlertType;
  entityType: DeliverabilityEntityType;
  entityId?: string | null;
  entityLabel?: string | null;
  title: string;
  message: string;
  recommendation?: string | null;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
  /// Window granularity for deduplication. Alerts sharing a type, entity, and
  /// window collapse into a single row.
  window?: string;
}

/// Day-granularity dedupe window: a persistent problem produces one alert per
/// day per entity rather than one per evaluation tick.
export function dailyWindow(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildDedupeKey(input: {
  alertType: string;
  entityType: string;
  entityId?: string | null;
  window: string;
}): string {
  return `${input.alertType}:${input.entityType}:${input.entityId ?? 'none'}:${input.window}`;
}

export class DeliverabilityAlertService {
  /**
   * Creates an alert, or refreshes the existing one when the same issue is still
   * present in the same window. Acknowledged alerts are not reopened by a repeat
   * observation within the window.
   */
  async raise(input: RaiseAlertInput): Promise<{ id: string; created: boolean }> {
    const occurredAt = input.occurredAt ?? new Date();
    const dedupeKey = buildDedupeKey({
      alertType: input.alertType,
      entityType: input.entityType,
      entityId: input.entityId,
      window: input.window ?? dailyWindow(occurredAt),
    });

    const existing = await prisma.deliverabilityAlert.findUnique({
      where: { workspaceId_dedupeKey: { workspaceId: input.workspaceId, dedupeKey } },
      select: { id: true, status: true },
    });

    if (existing) {
      if (existing.status === 'OPEN') {
        await prisma.deliverabilityAlert.update({
          where: { id: existing.id },
          data: {
            message: input.message,
            recommendation: input.recommendation ?? null,
            severity: input.severity,
            metadata: input.metadata ?? {},
          },
        });
      }
      return { id: existing.id, created: false };
    }

    const created = await prisma.deliverabilityAlert.create({
      data: {
        workspaceId: input.workspaceId,
        severity: input.severity,
        alertType: input.alertType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        title: input.title,
        message: input.message,
        recommendation: input.recommendation ?? null,
        dedupeKey,
        metadata: input.metadata ?? {},
        occurredAt,
      },
      select: { id: true },
    });

    return { id: created.id, created: true };
  }

  async updateStatus(
    workspaceId: string,
    alertId: string,
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED',
  ) {
    const result = await prisma.deliverabilityAlert.updateMany({
      where: { id: alertId, workspaceId },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
      },
    });
    return result.count > 0;
  }

  /// Closes open alerts for an entity whose underlying issue has cleared.
  async resolveOpenForEntity(
    workspaceId: string,
    entityType: DeliverabilityEntityType,
    entityId: string,
    alertTypes: DeliverabilityAlertType[],
  ): Promise<number> {
    const result = await prisma.deliverabilityAlert.updateMany({
      where: {
        workspaceId,
        entityType,
        entityId,
        status: 'OPEN',
        alertType: { in: alertTypes },
      },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Translates a mailbox evaluation into alerts. Only conditions that are
   * actually measured produce an alert; there is no periodic "all clear" noise.
   */
  async evaluateMailbox(input: {
    workspaceId: string;
    mailboxId: string;
    mailboxLabel: string;
    counters: DeliveryCounters;
    thresholds: DeliverabilityThresholds;
    evaluation: ProtectionEvaluation;
    healthScore: number;
    previousHealthScore?: number | null;
    paused: boolean;
    occurredAt?: Date;
  }): Promise<number> {
    const occurredAt = input.occurredAt ?? new Date();
    const rates = calculateRates(input.counters);
    const hasVolume = input.counters.attempted >= input.thresholds.minimumVolumeForRates;
    const base = {
      workspaceId: input.workspaceId,
      entityType: 'MAILBOX' as const,
      entityId: input.mailboxId,
      entityLabel: input.mailboxLabel,
      occurredAt,
    };
    const recommendation = input.evaluation.recommendations[0] ?? null;
    let raised = 0;
    const count = (result: { created: boolean }) => {
      if (result.created) raised += 1;
    };

    if (input.paused) {
      count(
        await this.raise({
          ...base,
          severity: 'CRITICAL',
          alertType: 'MAILBOX_PAUSED',
          title: 'Sending paused',
          message: `Sending from ${input.mailboxLabel} was paused by deliverability protection. ${input.evaluation.reason ?? ''}`.trim(),
          recommendation: 'Review recent bounces and resume sending once the underlying issue is resolved.',
          metadata: { healthScore: input.healthScore, bounceRate: rates.bounceRate },
        }),
      );
    }

    if (hasVolume && rates.bounceRate >= input.thresholds.warningBounceRatePercent) {
      count(
        await this.raise({
          ...base,
          severity:
            rates.bounceRate >= input.thresholds.criticalBounceRatePercent ? 'CRITICAL' : 'WARNING',
          alertType: 'ELEVATED_BOUNCE_RATE',
          title: 'Elevated bounce rate',
          message: `${input.mailboxLabel} has a ${rates.bounceRate}% bounce rate over the last 7 days.`,
          recommendation:
            recommendation ?? 'Review the recently imported lead list and verify addresses before sending.',
          metadata: { bounceRate: rates.bounceRate, attempted: input.counters.attempted },
        }),
      );
    }

    if (hasVolume && rates.failureRate >= input.thresholds.warningFailureRatePercent) {
      count(
        await this.raise({
          ...base,
          severity:
            rates.failureRate >= input.thresholds.criticalFailureRatePercent ? 'CRITICAL' : 'WARNING',
          alertType: 'ELEVATED_FAILURE_RATE',
          title: 'Sending failures increased',
          message: `${input.mailboxLabel} has a ${rates.failureRate}% send failure rate over the last 7 days.`,
          recommendation: 'Check SMTP credentials and connection limits for this mailbox.',
          metadata: { failureRate: rates.failureRate, failed: input.counters.failed },
        }),
      );
    }

    if (hasVolume && rates.unsubscribeRate >= input.thresholds.warningUnsubscribeRatePercent) {
      count(
        await this.raise({
          ...base,
          severity: 'WARNING',
          alertType: 'ELEVATED_UNSUBSCRIBE_RATE',
          title: 'Elevated unsubscribe rate',
          message: `${input.mailboxLabel} has a ${rates.unsubscribeRate}% unsubscribe rate over the last 7 days.`,
          recommendation: 'Review targeting and messaging relevance for this audience.',
          metadata: { unsubscribeRate: rates.unsubscribeRate },
        }),
      );
    }

    if (input.counters.hardBounces > 0) {
      count(
        await this.raise({
          ...base,
          severity: 'WARNING',
          alertType: 'HARD_BOUNCE_DETECTED',
          title: 'Hard bounces detected',
          message: `${input.counters.hardBounces} hard bounce(s) recorded for ${input.mailboxLabel}. Those recipients were suppressed automatically.`,
          recommendation: 'Review the source of these contacts and verify addresses before the next import.',
          metadata: { hardBounces: input.counters.hardBounces },
        }),
      );
    }

    if (
      typeof input.previousHealthScore === 'number' &&
      input.healthScore <= input.previousHealthScore - 15
    ) {
      count(
        await this.raise({
          ...base,
          severity: 'WARNING',
          alertType: 'MAILBOX_HEALTH_DROP',
          title: 'Mailbox health dropped',
          message: `Health for ${input.mailboxLabel} fell from ${input.previousHealthScore} to ${input.healthScore}.`,
          recommendation: recommendation ?? 'Review recent bounce and failure activity for this mailbox.',
          metadata: { from: input.previousHealthScore, to: input.healthScore },
        }),
      );
    }

    if (input.evaluation.level === 'NORMAL') {
      await this.resolveOpenForEntity(input.workspaceId, 'MAILBOX', input.mailboxId, [
        'ELEVATED_BOUNCE_RATE',
        'ELEVATED_FAILURE_RATE',
        'ELEVATED_UNSUBSCRIBE_RATE',
        'MAILBOX_PAUSED',
        'MAILBOX_HEALTH_DROP',
      ]);
    }

    return raised;
  }

  async evaluateDomain(input: {
    workspaceId: string;
    domain: Pick<DomainAuthResult, 'domain' | 'spfStatus' | 'dkimStatus' | 'dmarcStatus' | 'mxStatus'>;
    recommendation?: string | null;
    occurredAt?: Date;
  }): Promise<number> {
    const { domain } = input;
    const failing = (['spfStatus', 'dkimStatus', 'dmarcStatus', 'mxStatus'] as const).filter(
      (key) => domain[key] === 'FAIL' || domain[key] === 'INVALID',
    );
    if (failing.length === 0) {
      await this.resolveOpenForEntity(input.workspaceId, 'DOMAIN', domain.domain, ['DOMAIN_AUTH_ISSUE']);
      return 0;
    }

    const labels = failing.map((key) => key.replace('Status', '').toUpperCase()).join(', ');
    const result = await this.raise({
      workspaceId: input.workspaceId,
      severity: 'WARNING',
      alertType: 'DOMAIN_AUTH_ISSUE',
      entityType: 'DOMAIN',
      entityId: domain.domain,
      entityLabel: domain.domain,
      title: 'Mailbox authentication check failed',
      message: `Authentication checks for ${domain.domain} reported issues with: ${labels}.`,
      recommendation: input.recommendation ?? 'Review the DNS records for this sending domain.',
      metadata: { failing: labels },
      occurredAt: input.occurredAt,
    });
    return result.created ? 1 : 0;
  }

  async evaluateVelocity(input: {
    workspaceId: string;
    mailboxId: string;
    mailboxLabel: string;
    description: string;
    occurredAt?: Date;
  }): Promise<number> {
    const result = await this.raise({
      workspaceId: input.workspaceId,
      severity: 'INFO',
      alertType: 'SENDING_VELOCITY_ANOMALY',
      entityType: 'MAILBOX',
      entityId: input.mailboxId,
      entityLabel: input.mailboxLabel,
      title: 'Potentially unusual sending activity',
      message: input.description,
      recommendation: 'Confirm this increase was intentional before continuing at this volume.',
      occurredAt: input.occurredAt,
    });
    return result.created ? 1 : 0;
  }
}

export const deliverabilityAlertService = new DeliverabilityAlertService();
