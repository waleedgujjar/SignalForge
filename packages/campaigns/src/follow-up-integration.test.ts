import { describe, expect, it } from 'vitest';
import {
  buildDefaultFollowUpSteps,
  clampMaxFollowUps,
  validateDelayAmount,
} from './follow-up-policy.js';

describe('follow-up integration helpers', () => {
  it('seeds five follow-ups with default delays', () => {
    const steps = buildDefaultFollowUpSteps(5);
    expect(steps).toHaveLength(6);
    expect(steps[1]?.delayAmount).toBe(2);
    expect(steps[5]?.delayAmount).toBe(7);
  });

  it('enforces minimum delay for follow-ups', () => {
    expect(validateDelayAmount(1, 'DAYS')).toBeNull();
    expect(validateDelayAmount(0, 'DAYS')).not.toBeNull();
  });

  it('clamps follow-up count', () => {
    expect(clampMaxFollowUps(3)).toBe(3);
    expect(clampMaxFollowUps(99)).toBe(5);
  });
});
