import { describe, expect, it } from 'vitest';

import {
  AnalyticsRangeError,
  MAX_RANGE_DAYS,
  eachUtcDay,
  previousRange,
  resolveAnalyticsRange,
  toDateKey,
} from './range.js';

const NOW = new Date('2026-03-15T14:30:00.000Z');

describe('resolveAnalyticsRange', () => {
  it('starts today at the UTC day boundary and ends at the current instant', () => {
    const range = resolveAnalyticsRange({ period: 'today', now: NOW });

    expect(range.from.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(range.to).toEqual(NOW);
    expect(range.days).toBe(1);
  });

  it('covers only the previous whole day for yesterday', () => {
    const range = resolveAnalyticsRange({ period: 'yesterday', now: NOW });

    expect(range.from.toISOString()).toBe('2026-03-14T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-03-14T23:59:59.999Z');
    expect(range.days).toBe(1);
  });

  it.each([
    ['7d', '2026-03-09T00:00:00.000Z', 7],
    ['30d', '2026-02-14T00:00:00.000Z', 30],
    ['90d', '2025-12-16T00:00:00.000Z', 90],
  ] as const)('resolves the %s preset inclusive of today', (period, from, days) => {
    const range = resolveAnalyticsRange({ period, now: NOW });

    expect(range.from.toISOString()).toBe(from);
    expect(range.days).toBe(days);
  });

  it('defaults to 7 days when no period is given', () => {
    expect(resolveAnalyticsRange({ now: NOW }).period).toBe('7d');
  });

  it('snaps a custom range to whole UTC days', () => {
    const range = resolveAnalyticsRange({
      period: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-03',
      now: NOW,
    });

    expect(range.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-03-03T23:59:59.999Z');
    expect(range.days).toBe(3);
  });

  it('clamps a custom end date in the future to now', () => {
    const range = resolveAnalyticsRange({
      period: 'custom',
      startDate: '2026-03-10',
      endDate: '2026-12-31',
      now: NOW,
    });

    expect(range.to).toEqual(NOW);
  });

  it('rejects a custom range missing either date', () => {
    expect(() => resolveAnalyticsRange({ period: 'custom', startDate: '2026-03-01' })).toThrow(
      AnalyticsRangeError,
    );
  });

  it('rejects a start date after the end date', () => {
    expect(() =>
      resolveAnalyticsRange({ period: 'custom', startDate: '2026-03-05', endDate: '2026-03-01' }),
    ).toThrow(/on or before/);
  });

  it('rejects an unparseable date', () => {
    expect(() =>
      resolveAnalyticsRange({ period: 'custom', startDate: 'not-a-date', endDate: '2026-03-01' }),
    ).toThrow(AnalyticsRangeError);
  });

  it(`rejects ranges longer than ${MAX_RANGE_DAYS} days`, () => {
    expect(() =>
      resolveAnalyticsRange({
        period: 'custom',
        startDate: '2024-01-01',
        endDate: '2026-01-01',
        now: NOW,
      }),
    ).toThrow(/cannot exceed/);
  });
});

describe('previousRange', () => {
  it('returns an equally sized window ending just before the range starts', () => {
    const range = resolveAnalyticsRange({
      period: 'custom',
      startDate: '2026-03-08',
      endDate: '2026-03-14',
      now: NOW,
    });
    const previous = previousRange(range);

    expect(previous.to.toISOString()).toBe('2026-03-07T23:59:59.999Z');
    expect(previous.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('eachUtcDay', () => {
  it('lists every day boundary inclusively', () => {
    const days = eachUtcDay({
      from: new Date('2026-03-01T09:00:00.000Z'),
      to: new Date('2026-03-03T18:00:00.000Z'),
    });

    expect(days.map(toDateKey)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('returns a single day when the range is inside one day', () => {
    const days = eachUtcDay({
      from: new Date('2026-03-01T09:00:00.000Z'),
      to: new Date('2026-03-01T18:00:00.000Z'),
    });

    expect(days).toHaveLength(1);
  });
});
