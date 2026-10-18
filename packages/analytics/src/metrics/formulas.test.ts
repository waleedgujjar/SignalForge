import { describe, expect, it } from 'vitest';

import { MIN_LEADS_FOR_RATE } from '../types.js';
import {
  average,
  buildRate,
  buildTrend,
  contactRate,
  meetingRate,
  median,
  positiveReplyRate,
  qualificationRate,
  verificationRate,
} from './formulas.js';

describe('buildRate', () => {
  it('reports the percentage together with its denominator label', () => {
    const rate = buildRate(25, 100, 'contacted leads');

    expect(rate).toEqual({
      value: 25,
      numerator: 25,
      denominator: 100,
      denominatorLabel: 'contacted leads',
      sufficientData: true,
    });
  });

  it('withholds the rate when the sample is below the minimum', () => {
    const rate = buildRate(1, 3, 'contacted leads', { minimumSample: 20 });

    expect(rate.value).toBeNull();
    expect(rate.sufficientData).toBe(false);
    expect(rate.denominator).toBe(3);
  });

  it('withholds rather than dividing by zero', () => {
    expect(buildRate(0, 0, 'imported leads').value).toBeNull();
  });
});

describe('funnel rates', () => {
  // 100 imported leads that progress 100 -> 80 -> 60 -> 50 -> 20 -> 10 -> 4.
  it('computes each stage against the stage above it', () => {
    expect(verificationRate(80, 100).value).toBe(80);
    expect(qualificationRate(60, 80).value).toBe(75);
    expect(contactRate(50, 60).value).toBe(83.33);
    expect(positiveReplyRate(10, 20, 'replied leads').value).toBe(50);
    expect(meetingRate(4, 10, 'positive replies').value).toBe(40);
  });

  it('labels the denominator so a rate cannot be read against the wrong base', () => {
    expect(positiveReplyRate(10, 20, 'replied leads').denominatorLabel).toBe('replied leads');
    expect(positiveReplyRate(10, 50, 'contacted leads').denominatorLabel).toBe('contacted leads');
  });

  it(`withholds lead rates below ${MIN_LEADS_FOR_RATE} leads`, () => {
    expect(verificationRate(4, MIN_LEADS_FOR_RATE - 1).value).toBeNull();
    expect(verificationRate(4, MIN_LEADS_FOR_RATE).value).toBe(40);
  });
});

describe('buildTrend', () => {
  it('treats growth as an improvement for volume metrics', () => {
    expect(buildTrend(120, 100)).toMatchObject({ delta: 20, direction: 'IMPROVED' });
  });

  it('treats growth as a regression when lower is better', () => {
    expect(buildTrend(5, 2, true).direction).toBe('WORSENED');
  });

  it('reports no change when the value held steady', () => {
    expect(buildTrend(10, 10).direction).toBe('UNCHANGED');
  });
});

describe('NaN/Infinity guards', () => {
  it('buildRate never produces NaN or Infinity', () => {
    const cases = [
      buildRate(0, 0, 'test'),
      buildRate(1, 0, 'test'),
      buildRate(0, 1, 'test'),
      buildRate(100, 100, 'test'),
    ];
    for (const rate of cases) {
      if (rate.value !== null) {
        expect(Number.isFinite(rate.value)).toBe(true);
        expect(Number.isNaN(rate.value)).toBe(false);
      }
    }
  });

  it('buildTrend never produces NaN or Infinity', () => {
    const cases = [
      buildTrend(100, 0),
      buildTrend(0, 0),
      buildTrend(0, 100),
    ];
    for (const trend of cases) {
      expect(Number.isFinite(trend.delta)).toBe(true);
      expect(Number.isNaN(trend.delta)).toBe(false);
    }
  });

  it('handles 100% bounce scenario without NaN', () => {
    const rate = buildRate(100, 100, 'sent emails');
    expect(rate.value).toBe(100);
    expect(Number.isFinite(rate.value!)).toBe(true);
  });
});

describe('median and average', () => {
  it('averages the two middle values on an even sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is unmoved by an extreme outlier, unlike the average', () => {
    expect(median([1, 2, 3, 400])).toBe(2.5);
    expect(average([1, 2, 3, 400])).toBe(101.5);
  });

  it('returns null on an empty sample rather than zero', () => {
    expect(median([])).toBeNull();
    expect(average([])).toBeNull();
  });
});
