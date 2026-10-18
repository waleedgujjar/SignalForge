import { describe, expect, it } from 'vitest';

import { FUNNEL_DEFINITIONS, buildFunnel } from './funnel-service.js';
import type { FunnelCounts } from './metrics/counters.js';

const COHORT: FunnelCounts = {
  imported: 100,
  verified: 80,
  qualified: 60,
  contacted: 50,
  replied: 20,
  positiveReply: 10,
  meeting: 4,
};

describe('buildFunnel', () => {
  it('returns every stage in lifecycle order', () => {
    const funnel = buildFunnel(COHORT);

    expect(funnel.steps.map((step) => step.stage)).toEqual([
      'IMPORTED',
      'VERIFIED',
      'QUALIFIED',
      'CONTACTED',
      'REPLIED',
      'POSITIVE_REPLY',
      'MEETING',
    ]);
  });

  it('leaves the top stage without a conversion rate', () => {
    const [top] = buildFunnel(COHORT).steps;

    expect(top?.conversionFromPrevious).toBeNull();
    expect(top?.conversionFromTop).toBeNull();
    expect(top?.dropOff).toBe(0);
  });

  it('converts each stage against the previous stage and the top', () => {
    const steps = buildFunnel(COHORT).steps;
    const meeting = steps.at(-1);

    expect(steps[1]?.conversionFromPrevious?.value).toBe(80);
    expect(steps[3]?.conversionFromPrevious?.value).toBe(83.33);
    expect(meeting?.conversionFromPrevious?.value).toBe(40);
    expect(meeting?.conversionFromTop?.value).toBe(4);
  });

  it('reports drop-off as the leads lost since the previous stage', () => {
    const steps = buildFunnel(COHORT).steps;

    expect(steps[1]?.dropOff).toBe(20);
    expect(steps[4]?.dropOff).toBe(30);
  });

  it('never reports negative drop-off when a stage exceeds the one before it', () => {
    // A lead can be contacted without ever being verified, so stages are not
    // guaranteed to decrease.
    const steps = buildFunnel({ ...COHORT, verified: 10, qualified: 40 }).steps;

    expect(steps[2]?.dropOff).toBe(0);
    expect(steps[2]?.conversionFromPrevious?.value).toBe(400);
  });

  it('withholds conversions for a cohort too small to be meaningful', () => {
    const steps = buildFunnel({
      imported: 5,
      verified: 4,
      qualified: 3,
      contacted: 2,
      replied: 1,
      positiveReply: 1,
      meeting: 0,
    }).steps;

    expect(steps[1]?.conversionFromPrevious?.sufficientData).toBe(false);
    expect(steps[1]?.conversionFromPrevious?.value).toBeNull();
  });

  it('handles an empty workspace without dividing by zero', () => {
    const steps = buildFunnel({
      imported: 0,
      verified: 0,
      qualified: 0,
      contacted: 0,
      replied: 0,
      positiveReply: 0,
      meeting: 0,
    }).steps;

    expect(steps.every((step) => step.count === 0)).toBe(true);
    expect(steps[1]?.conversionFromPrevious?.value).toBeNull();
  });

  it('publishes a definition for every stage it returns', () => {
    const funnel = buildFunnel(COHORT);

    for (const step of funnel.steps) {
      expect(FUNNEL_DEFINITIONS[step.stage]).toBeTruthy();
      expect(funnel.definitions[step.stage]).toBe(FUNNEL_DEFINITIONS[step.stage]);
    }
  });
});
