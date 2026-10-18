import { describe, expect, it } from 'vitest';

import { EMPTY_COUNTERS } from './metrics/formulas.js';
import {
  calculateHealthScore,
  classifyTier,
  serializeScoreBreakdown,
  tierToHealthStatus,
  tierToProtectionLevel,
} from './health-score-service.js';
import { DEFAULT_THRESHOLDS, type DeliveryCounters } from './types.js';

function counters(overrides: Partial<DeliveryCounters> = {}): DeliveryCounters {
  return { ...EMPTY_COUNTERS, ...overrides };
}

describe('classifyTier', () => {
  it('maps scores onto the default tier bands', () => {
    expect(classifyTier(95, DEFAULT_THRESHOLDS)).toBe('EXCELLENT');
    expect(classifyTier(80, DEFAULT_THRESHOLDS)).toBe('HEALTHY');
    expect(classifyTier(65, DEFAULT_THRESHOLDS)).toBe('NEEDS_ATTENTION');
    expect(classifyTier(45, DEFAULT_THRESHOLDS)).toBe('AT_RISK');
    expect(classifyTier(10, DEFAULT_THRESHOLDS)).toBe('CRITICAL');
  });

  it('honours custom workspace thresholds', () => {
    const strict = { ...DEFAULT_THRESHOLDS, excellent: 98, healthy: 95 };
    expect(classifyTier(96, strict)).toBe('HEALTHY');
    expect(classifyTier(99, strict)).toBe('EXCELLENT');
  });
});

describe('tier mapping', () => {
  it('only escalates protection for degraded tiers', () => {
    expect(tierToProtectionLevel('EXCELLENT')).toBe('NORMAL');
    expect(tierToProtectionLevel('HEALTHY')).toBe('NORMAL');
    expect(tierToProtectionLevel('NEEDS_ATTENTION')).toBe('WARNING');
    expect(tierToProtectionLevel('AT_RISK')).toBe('AT_RISK');
    expect(tierToProtectionLevel('CRITICAL')).toBe('CRITICAL');
  });

  it('maps tiers onto the existing mailbox health statuses', () => {
    expect(tierToHealthStatus('HEALTHY')).toBe('HEALTHY');
    expect(tierToHealthStatus('AT_RISK')).toBe('DEGRADED');
    expect(tierToHealthStatus('CRITICAL')).toBe('UNHEALTHY');
  });
});

describe('calculateHealthScore', () => {
  it('scores a mailbox with no activity as perfectly healthy', () => {
    const result = calculateHealthScore({ counters: EMPTY_COUNTERS, warmupStatus: 'ACTIVE' });
    expect(result.score).toBe(100);
    expect(result.tier).toBe('EXCELLENT');
    expect(result.protectionLevel).toBe('NORMAL');
  });

  it('scores a clean high-volume mailbox near the top', () => {
    const result = calculateHealthScore({
      counters: counters({
        attempted: 500,
        sent: 500,
        delivered: 500,
        uniqueRepliedLeads: 50,
      }),
      warmupStatus: 'COMPLETED',
    });
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.tier).toBe('EXCELLENT');
  });

  it('drops the score sharply once bounces reach the critical threshold', () => {
    const clean = calculateHealthScore({
      counters: counters({ attempted: 200, sent: 200, delivered: 200 }),
      warmupStatus: 'ACTIVE',
    });
    const bouncing = calculateHealthScore({
      counters: counters({
        attempted: 200,
        sent: 180,
        delivered: 180,
        bounced: 20,
        hardBounces: 20,
      }),
      warmupStatus: 'ACTIVE',
    });

    expect(bouncing.score).toBeLessThan(clean.score);
    const bounceComponent = bouncing.components.find((component) => component.key === 'bounce');
    expect(bounceComponent?.points).toBe(0);
  });

  it('ignores rate components below the minimum volume so a few sends cannot tank a mailbox', () => {
    const result = calculateHealthScore({
      counters: counters({ attempted: 2, sent: 1, delivered: 1, bounced: 1, hardBounces: 1 }),
      warmupStatus: 'ACTIVE',
    });

    const bounce = result.components.find((component) => component.key === 'bounce');
    expect(bounce?.normalized).toBe(1);
    expect(bounce?.detail).toContain('minimum');
  });

  it('does not penalize a mailbox for unknown authentication results', () => {
    const unknown = calculateHealthScore({
      counters: EMPTY_COUNTERS,
      dns: {
        spfStatus: 'UNKNOWN',
        dkimStatus: 'UNKNOWN',
        dmarcStatus: 'UNKNOWN',
        mxStatus: 'UNKNOWN',
      },
      warmupStatus: 'ACTIVE',
    });

    const configuration = unknown.components.find(
      (component) => component.key === 'configuration',
    );
    expect(configuration?.normalized).toBe(1);
    expect(unknown.score).toBe(100);
  });

  it('penalizes a mailbox whose SPF and DMARC records are missing', () => {
    const failing = calculateHealthScore({
      counters: EMPTY_COUNTERS,
      dns: {
        spfStatus: 'FAIL',
        dkimStatus: 'UNKNOWN',
        dmarcStatus: 'FAIL',
        mxStatus: 'PASS',
      },
      warmupStatus: 'ACTIVE',
    });

    const configuration = failing.components.find((component) => component.key === 'configuration');
    expect(configuration?.normalized).toBeCloseTo(1 / 3, 5);
    expect(failing.score).toBeLessThan(100);
  });

  it('reduces the velocity component when an anomaly is detected', () => {
    const result = calculateHealthScore({
      counters: EMPTY_COUNTERS,
      warmupStatus: 'ACTIVE',
      velocityAnomaly: true,
    });
    const velocity = result.components.find((component) => component.key === 'velocity');
    expect(velocity?.normalized).toBe(0.4);
  });

  it('keeps the component weights summing to the configured total', () => {
    const result = calculateHealthScore({ counters: EMPTY_COUNTERS });
    const totalWeight = result.components.reduce((sum, component) => sum + component.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('serializes the breakdown into plain JSON for persistence', () => {
    const result = calculateHealthScore({ counters: EMPTY_COUNTERS });
    const serialized = serializeScoreBreakdown(result);

    expect(serialized.score).toBe(result.score);
    expect(serialized.tier).toBe(result.tier);
    expect(serialized.components).toHaveLength(result.components.length);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });
});
