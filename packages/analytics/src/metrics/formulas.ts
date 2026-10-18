import { compareTrend, toPercent } from '@signalforge/deliverability';
import {
  MIN_LEADS_FOR_RATE,
  MIN_SENDS_FOR_RATE,
  type MetricTrend,
  type RateValue,
} from '../types.js';

/**
 * Lead-lifecycle formulas. Email rates (delivery, bounce, failure, reply,
 * unsubscribe) are **not** defined here — those come from
 * `calculateRates()` in `@signalforge/deliverability` so a rate never means two
 * different things depending on which screen you are looking at.
 *
 * Every rate returned carries its numerator, denominator, and a label for the
 * denominator. Funnel conversions can be read against several plausible bases
 * (replies vs contacted leads, for instance), and an unlabelled percentage is
 * the easiest way to mislead someone.
 */

export interface RateOptions {
  /// Below this denominator the rate is withheld as statistically meaningless.
  minimumSample?: number;
}

export function buildRate(
  numerator: number,
  denominator: number,
  denominatorLabel: string,
  options: RateOptions = {},
): RateValue {
  const minimumSample = options.minimumSample ?? 1;
  const sufficientData = denominator >= minimumSample && denominator > 0;
  return {
    value: sufficientData ? toPercent(numerator / denominator) : null,
    numerator,
    denominator,
    denominatorLabel,
    sufficientData,
  };
}

export function leadRate(
  numerator: number,
  denominator: number,
  denominatorLabel: string,
): RateValue {
  return buildRate(numerator, denominator, denominatorLabel, {
    minimumSample: MIN_LEADS_FOR_RATE,
  });
}

export function sendRate(
  numerator: number,
  denominator: number,
  denominatorLabel: string,
): RateValue {
  return buildRate(numerator, denominator, denominatorLabel, {
    minimumSample: MIN_SENDS_FOR_RATE,
  });
}

export function verificationRate(verified: number, total: number): RateValue {
  return leadRate(verified, total, 'imported leads');
}

export function qualificationRate(qualified: number, verified: number): RateValue {
  return leadRate(qualified, verified, 'verified leads');
}

export function contactRate(contacted: number, qualified: number): RateValue {
  return leadRate(contacted, qualified, 'qualified leads');
}

export function positiveReplyRate(positive: number, denominator: number, label: string): RateValue {
  return leadRate(positive, denominator, label);
}

export function meetingRate(meetings: number, denominator: number, label: string): RateValue {
  return leadRate(meetings, denominator, label);
}

export function buildTrend(current: number, previous: number, lowerIsBetter = false): MetricTrend {
  const { direction, delta } = compareTrend(current, previous, lowerIsBetter);
  return { current, previous, delta, direction };
}

/// Median in hours; returns null on an empty sample rather than 0, which would
/// read as "instant replies".
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 100) / 100;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}
