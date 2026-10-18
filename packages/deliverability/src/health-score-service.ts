import { calculateRates } from './metrics/formulas.js';
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  type DeliverabilityProtectionLevel,
  type DeliverabilityThresholds,
  type DeliveryCounters,
  type DnsCheckStatus,
  type HealthScoreComponent,
  type HealthScoreResult,
  type HealthScoreWeights,
  type HealthTier,
} from './types.js';

/**
 * Transparent health score.
 *
 * The score is a weighted sum of eight independently computed components, each
 * normalized to 0..1 and multiplied by its configured weight. Default weights
 * total 100, so the raw sum is already on a 0-100 scale:
 *
 *   delivery      25   share of attempts the provider accepted
 *   bounce        25   bounce rate measured against the critical threshold
 *   failure       15   send failure rate against the critical threshold
 *   reply         10   unique reply rate, credited up to a 10% target
 *   unsubscribe   10   unsubscribe rate against the warning threshold
 *   configuration  5   SPF/DKIM/DMARC/MX check results (UNKNOWN is neutral)
 *   warmup         5   warmup state of the mailbox
 *   velocity       5   penalty when sending volume is anomalous
 *
 * A mailbox with no send activity scores 100 with every component neutral —
 * absence of data is never reported as a problem. Weights and thresholds are
 * workspace-configurable, and the component breakdown is returned alongside the
 * score so the UI can always explain how a number was reached.
 */

export interface HealthScoreInput {
  counters: DeliveryCounters;
  weights?: HealthScoreWeights;
  thresholds?: DeliverabilityThresholds;
  dns?: {
    spfStatus: DnsCheckStatus;
    dkimStatus: DnsCheckStatus;
    dmarcStatus: DnsCheckStatus;
    mxStatus: DnsCheckStatus;
  } | null;
  warmupStatus?: string | null;
  velocityAnomaly?: boolean;
}

/// Unique reply rate (percent) that earns full marks on the reply component.
const REPLY_TARGET_PERCENT = 10;

export function classifyTier(score: number, thresholds: DeliverabilityThresholds): HealthTier {
  if (score >= thresholds.excellent) return 'EXCELLENT';
  if (score >= thresholds.healthy) return 'HEALTHY';
  if (score >= thresholds.needsAttention) return 'NEEDS_ATTENTION';
  if (score >= thresholds.atRisk) return 'AT_RISK';
  return 'CRITICAL';
}

export function tierToProtectionLevel(tier: HealthTier): DeliverabilityProtectionLevel {
  switch (tier) {
    case 'EXCELLENT':
    case 'HEALTHY':
      return 'NORMAL';
    case 'NEEDS_ATTENTION':
      return 'WARNING';
    case 'AT_RISK':
      return 'AT_RISK';
    case 'CRITICAL':
      return 'CRITICAL';
  }
}

export function tierToHealthStatus(tier: HealthTier): 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' {
  switch (tier) {
    case 'EXCELLENT':
    case 'HEALTHY':
      return 'HEALTHY';
    case 'NEEDS_ATTENTION':
    case 'AT_RISK':
      return 'DEGRADED';
    case 'CRITICAL':
      return 'UNHEALTHY';
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/// Converts an observed rate into health, where hitting `criticalRate` scores 0.
function rateToHealth(observedPercent: number, criticalPercent: number): number {
  if (criticalPercent <= 0) return observedPercent > 0 ? 0 : 1;
  return clamp01(1 - observedPercent / criticalPercent);
}

function dnsStatusToHealth(status: DnsCheckStatus): number | null {
  if (status === 'PASS') return 1;
  if (status === 'FAIL' || status === 'INVALID') return 0;
  // UNKNOWN and NOT_CHECKED are excluded from the average rather than penalized.
  return null;
}

function warmupToHealth(status: string | null | undefined): number {
  switch (status) {
    case 'ACTIVE':
    case 'COMPLETED':
      return 1;
    case 'PAUSED':
      return 0.6;
    case 'BLOCKED':
      return 0;
    default:
      return 0.8;
  }
}

export function calculateHealthScore(input: HealthScoreInput): HealthScoreResult {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const rates = calculateRates(input.counters);
  const hasVolume = input.counters.attempted >= thresholds.minimumVolumeForRates;

  const components: HealthScoreComponent[] = [];

  const push = (
    key: keyof HealthScoreWeights,
    label: string,
    normalized: number,
    detail: string,
  ) => {
    const weight = weights[key];
    components.push({
      key,
      label,
      weight,
      normalized: clamp01(normalized),
      points: Math.round(clamp01(normalized) * weight * 100) / 100,
      detail,
    });
  };

  if (input.counters.attempted === 0) {
    push('delivery', 'Delivery success', 1, 'No sending activity in this period.');
    push('bounce', 'Bounce health', 1, 'No bounces recorded.');
    push('failure', 'Sending reliability', 1, 'No send failures recorded.');
    push('reply', 'Reply engagement', 1, 'No sends to measure replies against.');
    push('unsubscribe', 'Unsubscribe health', 1, 'No unsubscribes recorded.');
  } else {
    push(
      'delivery',
      'Delivery success',
      input.counters.delivered / input.counters.attempted,
      `${rates.deliveryRate}% of ${input.counters.attempted} attempts were accepted.`,
    );
    push(
      'bounce',
      'Bounce health',
      hasVolume ? rateToHealth(rates.bounceRate, thresholds.criticalBounceRatePercent) : 1,
      hasVolume
        ? `${rates.bounceRate}% bounce rate (critical at ${thresholds.criticalBounceRatePercent}%).`
        : `Below the ${thresholds.minimumVolumeForRates}-send minimum for rate scoring.`,
    );
    push(
      'failure',
      'Sending reliability',
      hasVolume ? rateToHealth(rates.failureRate, thresholds.criticalFailureRatePercent) : 1,
      hasVolume
        ? `${rates.failureRate}% failure rate (critical at ${thresholds.criticalFailureRatePercent}%).`
        : `Below the ${thresholds.minimumVolumeForRates}-send minimum for rate scoring.`,
    );
    push(
      'reply',
      'Reply engagement',
      hasVolume ? clamp01(rates.replyRate / REPLY_TARGET_PERCENT) : 1,
      hasVolume
        ? `${rates.replyRate}% unique reply rate (target ${REPLY_TARGET_PERCENT}%).`
        : 'Not enough sends to measure reply engagement.',
    );
    push(
      'unsubscribe',
      'Unsubscribe health',
      hasVolume
        ? rateToHealth(rates.unsubscribeRate, Math.max(thresholds.warningUnsubscribeRatePercent * 3, 0.1))
        : 1,
      hasVolume
        ? `${rates.unsubscribeRate}% unsubscribe rate (warning at ${thresholds.warningUnsubscribeRatePercent}%).`
        : 'Not enough sends to measure unsubscribes.',
    );
  }

  if (input.dns) {
    const checks = [
      dnsStatusToHealth(input.dns.spfStatus),
      dnsStatusToHealth(input.dns.dkimStatus),
      dnsStatusToHealth(input.dns.dmarcStatus),
      dnsStatusToHealth(input.dns.mxStatus),
    ].filter((value): value is number => value !== null);

    if (checks.length > 0) {
      const average = checks.reduce((sum, value) => sum + value, 0) / checks.length;
      push(
        'configuration',
        'Authentication configuration',
        average,
        `${checks.length} of 4 authentication checks returned a definitive result.`,
      );
    } else {
      push('configuration', 'Authentication configuration', 1, 'Authentication checks are unknown; not counted against health.');
    }
  } else {
    push('configuration', 'Authentication configuration', 1, 'Authentication checks have not been run.');
  }

  push(
    'warmup',
    'Warmup status',
    warmupToHealth(input.warmupStatus),
    `Warmup status: ${input.warmupStatus ?? 'UNKNOWN'}.`,
  );

  push(
    'velocity',
    'Sending velocity',
    input.velocityAnomaly ? 0.4 : 1,
    input.velocityAnomaly
      ? 'Sending volume is unusually high compared with the recent baseline.'
      : 'Sending volume is consistent with the recent baseline.',
  );

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const earned = components.reduce((sum, component) => sum + component.points, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 100;
  const tier = classifyTier(score, thresholds);

  return {
    score,
    tier,
    protectionLevel: tierToProtectionLevel(tier),
    components,
  };
}

export type SerializedScoreBreakdown = {
  tier: string;
  score: number;
  components: Array<{
    key: string;
    label: string;
    weight: number;
    normalized: number;
    points: number;
    detail: string;
  }>;
};

/// Plain JSON form of a score result, for persisting into `scoreBreakdown`.
export function serializeScoreBreakdown(score: HealthScoreResult): SerializedScoreBreakdown {
  return {
    tier: score.tier,
    score: score.score,
    components: score.components.map((component) => ({
      key: component.key,
      label: component.label,
      weight: component.weight,
      normalized: component.normalized,
      points: component.points,
      detail: component.detail,
    })),
  };
}

export const HEALTH_SCORE_EXPLANATION =
  'Health score is a weighted 0-100 measure of recent delivery success, bounce rate, ' +
  'send failure rate, unique reply rate, unsubscribe rate, domain authentication ' +
  'configuration, warmup status, and sending velocity. It reflects measurable sending ' +
  'signals and does not predict or guarantee inbox placement.';
