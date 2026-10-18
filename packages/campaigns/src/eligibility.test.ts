import { describe, expect, it } from 'vitest';
import { shouldExcludeByVerification } from '@signalforge/email';

describe('CampaignEligibility verification gating', () => {
  it('treats missing verification as ineligible when blockUnverified is true', () => {
    const exclusion = shouldExcludeByVerification(null, { blockUnverified: true });
    expect(exclusion.excluded).toBe(true);
  });

  it('allows missing verification when blockUnverified is false', () => {
    const exclusion = shouldExcludeByVerification(null, { blockUnverified: false });
    expect(exclusion.excluded).toBe(false);
  });

  it('allows verified business emails', () => {
    const exclusion = shouldExcludeByVerification(
      {
        email: 'ceo@acme.com',
        originalEmail: 'ceo@acme.com',
        normalizedEmail: 'ceo@acme.com',
        status: 'VERIFIED',
        score: 90,
        riskScore: 5,
        riskLevel: 'LOW',
        confidenceScore: 90,
        reason: 'Valid',
        reasonCode: 'VERIFIED',
        domain: 'acme.com',
        mxStatus: 'VALID',
        syntaxValid: true,
        domainValid: true,
        dnsResolved: true,
        mxFound: true,
        mxRecords: [],
        smtpStatus: 'ACCEPTED',
        isDisposable: false,
        isRole: false,
        roleType: null,
        isCatchAll: false,
        providerType: 'BUSINESS',
        verificationMethod: 'COMBINED',
        riskFactors: [],
        verificationVersion: 'v1',
      },
      { blockUnverified: true, blockRisky: true, blockUnknown: true },
    );
    expect(exclusion.excluded).toBe(false);
  });
});
