import type { DeliveryCounters, DeliveryRates } from '../types.js';

/**
 * Canonical deliverability formulas. Every screen, export, and alert reads
 * rates from here so a number never means two different things in the product.
 *
 * Denominator convention: `attempted` — the number of sends the system tried,
 * i.e. accepted sends plus rejected/failed sends. Using attempts (rather than
 * accepted sends) keeps bounce and failure rates comparable and stops a mailbox
 * from looking healthier as it fails more often.
 *
 *   deliveryRate    = delivered / attempted
 *   bounceRate      = bounced / attempted
 *   hardBounceRate  = hardBounces / attempted
 *   failureRate     = failed / attempted
 *   replyRate       = uniqueRepliedLeads / attempted   (unique recipients, not messages)
 *   unsubscribeRate = unsubscribes / attempted
 *   complaintRate   = complaints / attempted, or null when the provider
 *                     supplies no feedback-loop data (never estimated)
 */

export const EMPTY_COUNTERS: DeliveryCounters = {
  attempted: 0,
  sent: 0,
  delivered: 0,
  bounced: 0,
  hardBounces: 0,
  softBounces: 0,
  failed: 0,
  replies: 0,
  uniqueRepliedLeads: 0,
  unsubscribes: 0,
  complaints: 0,
  complaintDataAvailable: false,
};

export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function toPercent(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * 100 * factor) / factor;
}

export function calculateRates(counters: DeliveryCounters): DeliveryRates {
  const denominator = counters.attempted;
  return {
    deliveryRate: toPercent(ratio(counters.delivered, denominator)),
    bounceRate: toPercent(ratio(counters.bounced, denominator)),
    hardBounceRate: toPercent(ratio(counters.hardBounces, denominator)),
    failureRate: toPercent(ratio(counters.failed, denominator)),
    replyRate: toPercent(ratio(counters.uniqueRepliedLeads, denominator)),
    unsubscribeRate: toPercent(ratio(counters.unsubscribes, denominator)),
    complaintRate: counters.complaintDataAvailable
      ? toPercent(ratio(counters.complaints, denominator))
      : null,
  };
}

export function sumCounters(items: DeliveryCounters[]): DeliveryCounters {
  return items.reduce<DeliveryCounters>(
    (acc, item) => ({
      attempted: acc.attempted + item.attempted,
      sent: acc.sent + item.sent,
      delivered: acc.delivered + item.delivered,
      bounced: acc.bounced + item.bounced,
      hardBounces: acc.hardBounces + item.hardBounces,
      softBounces: acc.softBounces + item.softBounces,
      failed: acc.failed + item.failed,
      replies: acc.replies + item.replies,
      uniqueRepliedLeads: acc.uniqueRepliedLeads + item.uniqueRepliedLeads,
      unsubscribes: acc.unsubscribes + item.unsubscribes,
      complaints: acc.complaints + item.complaints,
      complaintDataAvailable: acc.complaintDataAvailable || item.complaintDataAvailable,
    }),
    { ...EMPTY_COUNTERS },
  );
}

export type TrendDirection = 'IMPROVED' | 'WORSENED' | 'UNCHANGED';

/**
 * Compares a metric against its previous period. `lowerIsBetter` distinguishes
 * bounce/failure/unsubscribe (lower is better) from delivery/reply rates.
 */
export function compareTrend(
  current: number,
  previous: number,
  lowerIsBetter: boolean,
  epsilon = 0.01,
): { direction: TrendDirection; delta: number } {
  const delta = Math.round((current - previous) * 100) / 100;
  if (Math.abs(delta) < epsilon) {
    return { direction: 'UNCHANGED', delta };
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return { direction: improved ? 'IMPROVED' : 'WORSENED', delta };
}
