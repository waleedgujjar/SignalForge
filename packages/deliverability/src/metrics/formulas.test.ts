import { describe, expect, it } from 'vitest';

import type { DeliveryCounters } from '../types.js';
import { EMPTY_COUNTERS, calculateRates, compareTrend, sumCounters, toPercent } from './formulas.js';

function counters(overrides: Partial<DeliveryCounters> = {}): DeliveryCounters {
  return { ...EMPTY_COUNTERS, ...overrides };
}

describe('calculateRates', () => {
  it('divides every rate by attempted sends', () => {
    const rates = calculateRates(
      counters({
        attempted: 200,
        delivered: 180,
        bounced: 10,
        hardBounces: 6,
        failed: 10,
        uniqueRepliedLeads: 20,
        unsubscribes: 4,
      }),
    );

    expect(rates.deliveryRate).toBe(90);
    expect(rates.bounceRate).toBe(5);
    expect(rates.hardBounceRate).toBe(3);
    expect(rates.failureRate).toBe(5);
    expect(rates.replyRate).toBe(10);
    expect(rates.unsubscribeRate).toBe(2);
  });

  it('returns zeroes instead of dividing by zero when nothing was attempted', () => {
    const rates = calculateRates(EMPTY_COUNTERS);
    expect(rates.bounceRate).toBe(0);
    expect(rates.deliveryRate).toBe(0);
    expect(rates.replyRate).toBe(0);
  });

  it('reports complaint rate as null when no feedback loop data exists', () => {
    expect(calculateRates(counters({ attempted: 100 })).complaintRate).toBeNull();
  });

  it('reports a complaint rate once feedback loop data is available', () => {
    const rates = calculateRates(
      counters({ attempted: 100, complaints: 2, complaintDataAvailable: true }),
    );
    expect(rates.complaintRate).toBe(2);
  });

  it('counts unique replying leads rather than reply messages', () => {
    const rates = calculateRates(
      counters({ attempted: 100, replies: 30, uniqueRepliedLeads: 12 }),
    );
    expect(rates.replyRate).toBe(12);
  });
});

describe('toPercent', () => {
  it('rounds to two decimals by default', () => {
    expect(toPercent(1 / 3)).toBe(33.33);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(1)).toBe(100);
  });
});

describe('sumCounters', () => {
  it('adds counters field by field', () => {
    const total = sumCounters([
      counters({ attempted: 10, sent: 9, bounced: 1, hardBounces: 1 }),
      counters({ attempted: 5, sent: 5, unsubscribes: 2 }),
    ]);

    expect(total.attempted).toBe(15);
    expect(total.sent).toBe(14);
    expect(total.hardBounces).toBe(1);
    expect(total.unsubscribes).toBe(2);
  });

  it('marks complaint data available when any input has it', () => {
    const total = sumCounters([
      counters({ attempted: 5 }),
      counters({ attempted: 5, complaintDataAvailable: true }),
    ]);
    expect(total.complaintDataAvailable).toBe(true);
  });

  it('returns empty counters for an empty list', () => {
    expect(sumCounters([])).toEqual(EMPTY_COUNTERS);
  });
});

describe('compareTrend', () => {
  it('treats a falling bounce rate as an improvement', () => {
    expect(compareTrend(2, 5, true)).toEqual({ direction: 'IMPROVED', delta: -3 });
  });

  it('treats a falling reply rate as a regression', () => {
    expect(compareTrend(2, 5, false)).toEqual({ direction: 'WORSENED', delta: -3 });
  });

  it('ignores changes below the epsilon', () => {
    expect(compareTrend(5.001, 5, true).direction).toBe('UNCHANGED');
  });
});
