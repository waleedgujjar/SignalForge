import type { VerificationResult, VerificationStatus } from './types.js';

export interface VerificationEligibilityPolicy {
  excludeInvalid?: boolean;
  excludeDisposable?: boolean;
  excludeHighRisk?: boolean;
  minScore?: number;
  blockUnverified?: boolean;
  allowRoleEmails?: boolean;
  blockRisky?: boolean;
  blockUnknown?: boolean;
}

export function shouldExcludeByVerification(
  result: VerificationResult | null | undefined,
  policy: VerificationEligibilityPolicy,
): { excluded: boolean; reason?: string } {
  if (!result) {
    if (policy.blockUnverified !== false) {
      return { excluded: true, reason: 'UNVERIFIED_EMAIL' };
    }
    return { excluded: false };
  }

  if (policy.excludeInvalid !== false && result.status === 'INVALID') {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_INVALID' };
  }
  if (policy.excludeDisposable !== false && result.status === 'DISPOSABLE') {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_DISPOSABLE' };
  }
  if (policy.blockRisky !== false && (result.status === 'RISKY' || result.riskLevel === 'HIGH' || result.riskLevel === 'VERY_HIGH')) {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_RISKY' };
  }
  if (policy.blockUnknown !== false && result.status === 'UNKNOWN') {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_UNKNOWN' };
  }
  if (result.status === 'ROLE_BASED' && !policy.allowRoleEmails) {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_ROLE' };
  }
  if (policy.excludeHighRisk !== false) {
    const minScore = policy.minScore ?? 50;
    if (result.score < minScore || result.riskScore > 50) {
      return { excluded: true, reason: 'EMAIL_VERIFICATION_LOW_SCORE' };
    }
  }

  return { excluded: false };
}

export function toLegacyVerificationResult(result: VerificationResult): {
  email: string;
  status: VerificationStatus;
  score: number;
  reason: string;
  domain: string;
  mxStatus: string;
} {
  return {
    email: result.email,
    status: result.status,
    score: result.score,
    reason: result.reason,
    domain: result.domain,
    mxStatus: result.mxStatus,
  };
}
