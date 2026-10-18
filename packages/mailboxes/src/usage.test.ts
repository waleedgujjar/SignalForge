import { describe, expect, it } from 'vitest';
import { computeUsageDate } from './usage-date.js';

describe('computeUsageDate', () => {
  it('returns the local calendar date for the given timezone', () => {
    // 2026-01-15T05:30:00Z is 2026-01-15 in New York (UTC-5) but 2026-01-15 in Tokyo (UTC+9)
    const utcNoon = new Date('2026-06-15T12:00:00Z');
    expect(computeUsageDate(utcNoon, 'America/New_York')).toBe('2026-06-15');
    expect(computeUsageDate(utcNoon, 'Asia/Tokyo')).toBe('2026-06-15');
  });

  it('crosses the date line correctly near midnight', () => {
    // 04:00 UTC is still previous day (23:00) in New York
    const nearMidnight = new Date('2026-06-15T04:00:00Z');
    expect(computeUsageDate(nearMidnight, 'America/New_York')).toBe('2026-06-15');
    const earlyMorning = new Date('2026-06-15T02:00:00Z');
    expect(computeUsageDate(earlyMorning, 'America/New_York')).toBe('2026-06-14');
  });

  it('falls back to UTC when timezone is invalid', () => {
    const utcNoon = new Date('2026-06-15T12:00:00Z');
    expect(computeUsageDate(utcNoon, 'Not/A_Timezone')).toBe('2026-06-15');
  });
});
