import { describe, expect, it } from 'vitest';
import { shouldExcludeByVerification } from './eligibility.js';
import type { VerificationResult } from './types.js';

function baseResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    email: 'user@example.com',
    originalEmail: 'user@example.com',
    normalizedEmail: 'user@example.com',
    status: 'VERIFIED',
    score: 80,
    riskScore: 10,
    riskLevel: 'LOW',
    confidenceScore: 85,
    reason: 'Valid',
    reasonCode: 'VERIFIED',
    domain: 'example.com',
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
    ...overrides,
  };
}

describe('shouldExcludeByVerification', () => {
  it('blocks unverified emails by default', () => {
    const result = shouldExcludeByVerification(null, { blockUnverified: true });
    expect(result.excluded).toBe(true);
    expect(result.reason).toBe('UNVERIFIED_EMAIL');
  });

  it('blocks risky emails by default', () => {
    const result = shouldExcludeByVerification(
      baseResult({ status: 'RISKY', riskLevel: 'HIGH' }),
      {},
    );
    expect(result.excluded).toBe(true);
    expect(result.reason).toBe('EMAIL_VERIFICATION_RISKY');
  });

  it('blocks role emails unless allowed', () => {
    const result = shouldExcludeByVerification(
      baseResult({ status: 'ROLE_BASED', isRole: true }),
      { allowRoleEmails: false },
    );
    expect(result.excluded).toBe(true);
    expect(result.reason).toBe('EMAIL_VERIFICATION_ROLE');
  });
});
