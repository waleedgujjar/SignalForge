import { describe, expect, it } from 'vitest';

import { EMPTY_COUNTERS, calculateRates } from './metrics/formulas.js';
import { buildDomainRecommendations, buildRecommendations } from './recommendation-service.js';
import type { DeliverabilityProtectionLevel, DeliveryCounters } from './types.js';

function build(
  overrides: Partial<DeliveryCounters>,
  level: DeliverabilityProtectionLevel = 'NORMAL',
) {
  const counters = { ...EMPTY_COUNTERS, ...overrides };
  return buildRecommendations({ counters, rates: calculateRates(counters), level });
}

describe('buildRecommendations', () => {
  it('says nothing when there is no activity to comment on', () => {
    expect(build({})).toEqual([]);
  });

  it('flags stale lead data when hard bounces appear', () => {
    const recommendations = build({ attempted: 100, sent: 95, hardBounces: 5, bounced: 5 });
    expect(recommendations.join(' ')).toContain('hard bounces');
  });

  it('mentions throttling or full mailboxes for repeated soft bounces', () => {
    const recommendations = build({ attempted: 100, sent: 96, softBounces: 4, bounced: 4 });
    expect(recommendations.join(' ')).toContain('temporarily');
  });

  it('points at credentials and connection limits for send failures', () => {
    const recommendations = build({ attempted: 100, sent: 95, failed: 5 });
    expect(recommendations.join(' ')).toContain('SMTP errors');
  });

  it('advises reducing volume when protection is critical', () => {
    const recommendations = build({ attempted: 100, sent: 90, bounced: 10, hardBounces: 10 }, 'CRITICAL');
    expect(recommendations.join(' ')).toContain('Reduce sending volume');
  });
});

describe('buildDomainRecommendations', () => {
  it('returns nothing for a fully configured domain', () => {
    expect(
      buildDomainRecommendations({
        domain: 'example.com',
        spfStatus: 'PASS',
        dkimStatus: 'PASS',
        dmarcStatus: 'PASS',
        mxStatus: 'PASS',
      }),
    ).toEqual([]);
  });

  it('asks for a DKIM selector rather than reporting a failure when DKIM is unknown', () => {
    const recommendations = buildDomainRecommendations({
      domain: 'example.com',
      spfStatus: 'PASS',
      dkimStatus: 'UNKNOWN',
      dmarcStatus: 'PASS',
      mxStatus: 'PASS',
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toContain('Add a DKIM selector');
  });

  it('names each misconfigured record', () => {
    const recommendations = buildDomainRecommendations({
      domain: 'example.com',
      spfStatus: 'INVALID',
      dkimStatus: 'FAIL',
      dmarcStatus: 'FAIL',
      mxStatus: 'FAIL',
    }).join(' ');

    expect(recommendations).toContain('SPF');
    expect(recommendations).toContain('DKIM');
    expect(recommendations).toContain('DMARC');
    expect(recommendations).toContain('MX records');
  });
});
