import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS_PER_EXECUTION,
  MAX_EXECUTION_DURATION_MS,
  MAX_NODE_RETRIES,
  isExecutionExpired,
  hasExceededStepLimit,
} from './limits.js';

describe('constants', () => {
  it('MAX_STEPS_PER_EXECUTION is 100', () => {
    expect(MAX_STEPS_PER_EXECUTION).toBe(100);
  });

  it('MAX_EXECUTION_DURATION_MS is 30 days', () => {
    expect(MAX_EXECUTION_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('MAX_NODE_RETRIES is 3', () => {
    expect(MAX_NODE_RETRIES).toBe(3);
  });
});

describe('isExecutionExpired', () => {
  it('returns false when within duration', () => {
    const startedAt = new Date(Date.now() - 1000);
    expect(isExecutionExpired(startedAt)).toBe(false);
  });

  it('returns true when exceeding max duration', () => {
    const startedAt = new Date(Date.now() - MAX_EXECUTION_DURATION_MS - 1);
    expect(isExecutionExpired(startedAt)).toBe(true);
  });

  it('returns false at exactly the boundary', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const startedAt = new Date(now.getTime() - MAX_EXECUTION_DURATION_MS);
    expect(isExecutionExpired(startedAt, now)).toBe(false);
  });

  it('uses provided now parameter', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const startedAt = new Date('2026-05-01T00:00:00Z');
    expect(isExecutionExpired(startedAt, now)).toBe(true);
  });

  it('returns false for very recent execution', () => {
    const now = new Date();
    expect(isExecutionExpired(now, now)).toBe(false);
  });
});

describe('hasExceededStepLimit', () => {
  it('returns false below limit', () => {
    expect(hasExceededStepLimit(0)).toBe(false);
    expect(hasExceededStepLimit(50)).toBe(false);
    expect(hasExceededStepLimit(99)).toBe(false);
  });

  it('returns true at limit', () => {
    expect(hasExceededStepLimit(100)).toBe(true);
  });

  it('returns true above limit', () => {
    expect(hasExceededStepLimit(101)).toBe(true);
    expect(hasExceededStepLimit(999)).toBe(true);
  });
});
