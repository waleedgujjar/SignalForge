import { describe, expect, it } from 'vitest';

import { calculateHealthScore } from './health-score-service.js';
import { EMPTY_COUNTERS } from './metrics/formulas.js';
import { evaluateProtectionLevel } from './protection-service.js';
import {
  DEFAULT_PROTECTION,
  DEFAULT_THRESHOLDS,
  type DeliveryCounters,
} from './types.js';

function counters(overrides: Partial<DeliveryCounters> = {}): DeliveryCounters {
  return { ...EMPTY_COUNTERS, ...overrides };
}

function evaluate(
  input: Partial<DeliveryCounters>,
  protection = DEFAULT_PROTECTION,
  thresholds = DEFAULT_THRESHOLDS,
) {
  const values = counters(input);
  const score = calculateHealthScore({ counters: values, thresholds, warmupStatus: 'ACTIVE' });
  return evaluateProtectionLevel(values, score, thresholds, protection);
}

describe('evaluateProtectionLevel', () => {
  it('leaves a clean mailbox at NORMAL with no reason', () => {
    const result = evaluate({ attempted: 300, sent: 300, delivered: 300, uniqueRepliedLeads: 30 });
    expect(result.level).toBe('NORMAL');
    expect(result.reason).toBeNull();
    expect(result.shouldPauseMailbox).toBe(false);
  });

  it('escalates to WARNING when the bounce rate is elevated but not critical', () => {
    const result = evaluate({ attempted: 100, sent: 97, delivered: 97, bounced: 3, softBounces: 3 });
    expect(result.level).toBe('WARNING');
    expect(result.reason).toContain('Bounce rate');
  });

  it('escalates to CRITICAL and pauses when the bounce rate hits the critical threshold', () => {
    const result = evaluate({
      attempted: 100,
      sent: 90,
      delivered: 90,
      bounced: 10,
      hardBounces: 10,
    });

    expect(result.level).toBe('CRITICAL');
    expect(result.shouldPauseMailbox).toBe(true);
    expect(result.reason).toContain('critical threshold');
  });

  it('does not pause when the workspace has disabled automatic pausing', () => {
    const result = evaluate(
      { attempted: 100, sent: 90, delivered: 90, bounced: 10, hardBounces: 10 },
      { ...DEFAULT_PROTECTION, pauseOnCriticalBounceRate: false },
    );

    expect(result.level).toBe('CRITICAL');
    expect(result.shouldPauseMailbox).toBe(false);
  });

  it('escalates on send failures independently of bounces', () => {
    const result = evaluate({ attempted: 100, sent: 95, delivered: 95, failed: 5 });
    expect(result.level).toBe('CRITICAL');
    expect(result.reason).toContain('failure rate');
  });

  it('does not act on rates below the minimum volume', () => {
    const result = evaluate({ attempted: 5, sent: 4, delivered: 4, bounced: 1, hardBounces: 1 });
    expect(result.level).toBe('NORMAL');
    expect(result.reason).toBeNull();
  });

  it('returns actionable recommendations alongside the level', () => {
    const result = evaluate({
      attempted: 100,
      sent: 90,
      delivered: 90,
      bounced: 10,
      hardBounces: 10,
    });
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.join(' ')).toContain('hard bounces');
  });

  it('respects custom workspace thresholds', () => {
    const lenient = {
      ...DEFAULT_THRESHOLDS,
      warningBounceRatePercent: 10,
      criticalBounceRatePercent: 20,
    };
    const result = evaluate(
      { attempted: 100, sent: 95, delivered: 95, bounced: 5, softBounces: 5 },
      DEFAULT_PROTECTION,
      lenient,
    );
    expect(result.level).toBe('NORMAL');
  });
});
