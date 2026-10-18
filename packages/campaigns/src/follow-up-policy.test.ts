import { describe, expect, it } from 'vitest';
import {
  MAX_FOLLOW_UPS,
  MAX_SEQUENCE_STEPS,
  buildDefaultFollowUpSteps,
  clampMaxFollowUps,
  countFollowUpSteps,
  getDefaultFollowUpDelayDays,
  validateDelayAmount,
} from './follow-up-policy.js';

describe('follow-up-policy', () => {
  it('caps max follow-ups at 5', () => {
    expect(clampMaxFollowUps(10)).toBe(5);
    expect(clampMaxFollowUps(0)).toBe(1);
  });

  it('uses default delay map 2/3/4/5/7 days', () => {
    expect(getDefaultFollowUpDelayDays(0)).toBe(2);
    expect(getDefaultFollowUpDelayDays(4)).toBe(7);
  });

  it('builds initial + N follow-up steps', () => {
    const steps = buildDefaultFollowUpSteps(3);
    expect(steps).toHaveLength(4);
    expect(steps[0]!.order).toBe(0);
    expect(steps[0]!.delayAmount).toBe(0);
    expect(steps[1]!.delayAmount).toBe(2);
    expect(steps[2]!.delayAmount).toBe(3);
    expect(steps[3]!.delayAmount).toBe(4);
  });

  it('validates minimum delays', () => {
    expect(validateDelayAmount(29, 'MINUTES')).toMatch(/at least 30/);
    expect(validateDelayAmount(30, 'MINUTES')).toBeNull();
    expect(validateDelayAmount(0, 'DAYS')).toMatch(/at least 1/);
  });

  it('counts follow-up steps excluding initial', () => {
    const steps = [
      { order: 0, enabled: true },
      { order: 1, enabled: true },
      { order: 2, enabled: false },
      { order: 3, enabled: true },
    ];
    expect(countFollowUpSteps(steps)).toBe(2);
  });

  it('defines max sequence steps as initial + 5 follow-ups', () => {
    expect(MAX_SEQUENCE_STEPS).toBe(MAX_FOLLOW_UPS + 1);
  });
});
