import { describe, expect, it } from 'vitest';
import { advanceLimit, computeCurrentLimit, isWarmupComplete } from './ramp-calculator.js';

describe('computeCurrentLimit', () => {
  it('returns starting limit when startDate is null', () => {
    const result = computeCurrentLimit({
      startingDailyLimit: 5,
      maximumDailyLimit: 50,
      rampStep: 5,
      rampIntervalHours: 24,
      startDate: null,
      lastProgressionAt: null,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.currentLimit).toBe(5);
    expect(result.shouldProgress).toBe(false);
  });

  it('caps the target at the maximum limit', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-04-01T00:00:00Z');
    const result = computeCurrentLimit({
      startingDailyLimit: 5,
      maximumDailyLimit: 50,
      rampStep: 5,
      rampIntervalHours: 24,
      startDate: start,
      lastProgressionAt: start,
      now,
    });
    expect(result.currentLimit).toBe(50);
  });

  it('signals progression after the interval elapses', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-04T00:00:00Z');
    const result = computeCurrentLimit({
      startingDailyLimit: 5,
      maximumDailyLimit: 50,
      rampStep: 5,
      rampIntervalHours: 24,
      startDate: start,
      lastProgressionAt: start,
      now,
    });
    expect(result.shouldProgress).toBe(true);
    expect(result.currentLimit).toBeGreaterThanOrEqual(15);
  });

  it('holds ramp progression when holdRamp is true', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-05T00:00:00Z');
    const result = computeCurrentLimit({
      startingDailyLimit: 5,
      maximumDailyLimit: 50,
      rampStep: 5,
      rampIntervalHours: 24,
      startDate: start,
      lastProgressionAt: start,
      now,
      holdRamp: true,
    });
    expect(result.shouldProgress).toBe(false);
  });
});

describe('advanceLimit', () => {
  it('adds step and caps at max', () => {
    expect(advanceLimit(45, 10, 50)).toBe(50);
    expect(advanceLimit(20, 5, 50)).toBe(25);
  });
});

describe('isWarmupComplete', () => {
  it('is true only when current reaches max', () => {
    expect(isWarmupComplete(50, 50)).toBe(true);
    expect(isWarmupComplete(49, 50)).toBe(false);
  });
});
