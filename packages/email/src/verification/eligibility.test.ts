import { describe, expect, it } from 'vitest';
import { shouldExcludeByVerification, verificationEligibilityTier } from './eligibility.js';
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
    checks: [],
    smtpResponse: null,
    verificationVersion: 'v2',
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

  it('blocks catch-all emails unless allowed', () => {
    const blocked = shouldExcludeByVerification(baseResult({ status: 'CATCH_ALL', isCatchAll: true, riskScore: 35, riskLevel: 'MEDIUM' }), {});
    expect(blocked).toEqual({ excluded: true, reason: 'EMAIL_VERIFICATION_CATCH_ALL' });
    const allowed = shouldExcludeByVerification(
      baseResult({ status: 'CATCH_ALL', isCatchAll: true, riskScore: 35, riskLevel: 'MEDIUM', score: 70 }),
      { blockCatchAll: false },
    );
    expect(allowed.excluded).toBe(false);
  });

  it('lets a valid-domain unknown through when unknowns are allowed', () => {
    const result = shouldExcludeByVerification(
      baseResult({ status: 'UNKNOWN', smtpStatus: 'UNAVAILABLE', score: 60, riskScore: 10, riskLevel: 'LOW' }),
      { blockUnknown: false },
    );
    expect(result.excluded).toBe(false);
  });
});

describe('verificationEligibilityTier', () => {
  it.each([
    ['VERIFIED', 'ELIGIBLE'],
    ['INVALID', 'NOT_ELIGIBLE'],
    ['DISPOSABLE', 'NOT_ELIGIBLE'],
    ['RISKY', 'REVIEW'],
    ['UNKNOWN', 'REVIEW'],
    ['CATCH_ALL', 'REVIEW'],
    ['ROLE_BASED', 'REVIEW'],
    [null, 'UNVERIFIED'],
  ])('%s -> %s', (status, tier) => {
    expect(verificationEligibilityTier(status)).toBe(tier);
  });
});
