import { describe, expect, it } from 'vitest';
import {
  calculateNextSendTime,
  calculateNextValidSlot,
  computeCampaignUsageDate,
  isWithinSendingWindow,
} from './schedule-calculator.js';

describe('isWithinSendingWindow', () => {
  it('returns true when time is within window on allowed weekday', () => {
    const now = new Date('2026-08-31T14:00:00Z');
    expect(
      isWithinSendingWindow(now, {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).toBe(true);
  });

  it('returns false when time is outside window', () => {
    const now = new Date('2026-08-31T20:00:00Z');
    expect(
      isWithinSendingWindow(now, {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).toBe(false);
  });

  it('returns false on disabled weekday', () => {
    const now = new Date('2026-08-30T14:00:00Z');
    expect(
      isWithinSendingWindow(now, {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).toBe(false);
  });

  it('respects timezone offset', () => {
    const now = new Date('2026-09-01T02:00:00Z');
    expect(
      isWithinSendingWindow(now, {
        timezone: 'Asia/Kolkata',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).toBe(false);
    const inside = new Date('2026-09-01T08:00:00Z');
    expect(
      isWithinSendingWindow(inside, {
        timezone: 'Asia/Kolkata',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).toBe(true);
  });
});

describe('calculateNextSendTime', () => {
  it('returns a time within the window when inside the window', () => {
    const now = new Date('2026-08-31T14:00:00Z');
    const result = calculateNextSendTime({
      now,
      config: {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
        minDelayMinutes: 2,
        maxDelayMinutes: 2,
      },
      rng: () => 0,
    });
    expect(result.withinWindow).toBe(true);
    expect(result.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('rolls to next allowed day when outside window', () => {
    const now = new Date('2026-08-30T14:00:00Z');
    const result = calculateNextSendTime({
      now,
      config: {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
      },
      rng: () => 0,
    });
    expect(result.withinWindow).toBe(false);
    expect(result.scheduledAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('respects randomized delay bounds', () => {
    const now = new Date('2026-08-31T14:00:00Z');
    const result = calculateNextSendTime({
      now,
      config: {
        timezone: 'UTC',
        days: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
        minDelayMinutes: 5,
        maxDelayMinutes: 5,
      },
      rng: () => 0.5,
    });
    const delta = (result.scheduledAt.getTime() - now.getTime()) / 60_000;
    expect(delta).toBeCloseTo(5, 0);
  });
});

describe('calculateNextValidSlot', () => {
  it('returns now when inside window', () => {
    const now = new Date('2026-08-31T14:00:00Z');
    const slot = calculateNextValidSlot(now, {
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(slot.getTime()).toBe(now.getTime());
  });

  it('rolls forward to next window start when outside', () => {
    const now = new Date('2026-08-31T20:00:00Z');
    const slot = calculateNextValidSlot(now, {
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
    });
    expect(slot.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('computeCampaignUsageDate', () => {
  it('returns yyyy-MM-dd formatted date', () => {
    const now = new Date('2026-08-31T20:00:00Z');
    const value = computeCampaignUsageDate(now, 'UTC');
    expect(value).toBe('2026-08-31');
  });

  it('respects timezone for date rollover', () => {
    const now = new Date('2026-09-01T02:00:00Z');
    const kolkata = computeCampaignUsageDate(now, 'Asia/Kolkata');
    expect(kolkata).toBe('2026-09-01');
    const la = computeCampaignUsageDate(now, 'America/Los_Angeles');
    expect(la).toBe('2026-08-31');
  });

  it('falls back to UTC on invalid timezone', () => {
    const now = new Date('2026-08-31T23:59:00Z');
    const value = computeCampaignUsageDate(now, 'Not/AZone');
    expect(value).toBe('2026-08-31');
  });
});
