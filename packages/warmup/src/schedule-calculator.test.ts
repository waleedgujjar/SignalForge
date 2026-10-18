import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  computeUsageDate,
  distributeSlots,
  isWithinWarmupWindow,
  usageDateStart,
} from './schedule-calculator.js';

const WEEKDAYS = [1, 2, 3, 4, 5];

describe('isWithinWarmupWindow', () => {
  it('is true weekdays between 09:00 and 17:00 UTC', () => {
    const inside = new Date('2026-01-05T12:00:00Z');
    expect(
      isWithinWarmupWindow(inside, {
        timezone: 'UTC',
        weekdays: WEEKDAYS,
        windowStart: '09:00',
        windowEnd: '17:00',
      }),
    ).toBe(true);
  });

  it('is false on weekends', () => {
    const saturday = new Date('2026-01-03T12:00:00Z');
    expect(
      isWithinWarmupWindow(saturday, {
        timezone: 'UTC',
        weekdays: WEEKDAYS,
        windowStart: '09:00',
        windowEnd: '17:00',
      }),
    ).toBe(false);
  });

  it('respects timezone offsets', () => {
    // 03:00 UTC = 22:00 previous day America/New_York
    const before = new Date('2026-01-05T03:00:00Z');
    expect(
      isWithinWarmupWindow(before, {
        timezone: 'America/New_York',
        weekdays: WEEKDAYS,
        windowStart: '09:00',
        windowEnd: '17:00',
      }),
    ).toBe(false);
  });
});

describe('computeUsageDate', () => {
  it('returns local date string for a given timezone', () => {
    const at = new Date('2026-01-06T04:00:00Z');
    expect(computeUsageDate(at, 'America/New_York')).toBe('2026-01-05');
    expect(computeUsageDate(at, 'UTC')).toBe('2026-01-06');
  });
});

describe('distributeSlots', () => {
  it('returns an empty array when the day is not in weekdays', () => {
    const localDate = DateTime.fromISO('2026-01-03', { zone: 'UTC' }).startOf('day');
    const slots = distributeSlots(5, localDate, {
      timezone: 'UTC',
      weekdays: WEEKDAYS,
      windowStart: '09:00',
      windowEnd: '17:00',
    });
    expect(slots).toEqual([]);
  });

  it('distributes N slots evenly within the window', () => {
    const localDate = DateTime.fromISO('2026-01-05', { zone: 'UTC' }).startOf('day');
    const slots = distributeSlots(4, localDate, {
      timezone: 'UTC',
      weekdays: WEEKDAYS,
      windowStart: '09:00',
      windowEnd: '17:00',
    });
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      const local = DateTime.fromJSDate(slot, { zone: 'UTC' });
      expect(local.hour * 60 + local.minute).toBeGreaterThanOrEqual(9 * 60);
      expect(local.hour * 60 + local.minute).toBeLessThan(17 * 60);
    }
  });
});

describe('usageDateStart', () => {
  it('parses usage dates into zoned start-of-day', () => {
    const dt = usageDateStart('2026-01-05', 'America/New_York');
    expect(dt.zoneName).toBe('America/New_York');
    expect(dt.hour).toBe(0);
    expect(dt.day).toBe(5);
  });
});
