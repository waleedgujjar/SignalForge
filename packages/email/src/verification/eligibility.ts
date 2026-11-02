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
  /** Catch-all domains accept any address; default: blocked like risky. */
  blockCatchAll?: boolean;
  /**
   * A person reviewed this lead and approved sending despite a review-tier
   * result (risky, unknown, catch-all, role, low score). Never waives invalid,
   * disposable or unverified.
   */
  reviewApproved?: boolean;
}

/** The fields eligibility needs; a stored LeadVerification row satisfies it. */
export interface VerificationLike {
  status: VerificationStatus | string;
  score: number;
  riskScore?: number | null;
  riskLevel?: string | null;
}

const DEFAULT_POLICY: Required<Omit<VerificationEligibilityPolicy, 'reviewApproved'>> = {
  excludeInvalid: true,
  excludeDisposable: true,
  excludeHighRisk: true,
  minScore: 50,
  blockUnverified: true,
  allowRoleEmails: false,
  blockRisky: true,
  blockUnknown: true,
  blockCatchAll: true,
};

type PolicyLayer = Partial<Record<keyof VerificationEligibilityPolicy, unknown>> | null | undefined;

/**
 * The one place verification policy defaults live. Layers are applied in
 * order (workspace policy row, then campaign override, then call-specific);
 * null/undefined fields in a layer are ignored. Enrollment and send time both
 * use this, so a lead accepted at enrollment is not silently blocked at send.
 */
export function resolveVerificationPolicy(...layers: PolicyLayer[]): VerificationEligibilityPolicy {
  const policy: VerificationEligibilityPolicy = { ...DEFAULT_POLICY };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(DEFAULT_POLICY) as (keyof typeof DEFAULT_POLICY)[]) {
      const value = layer[key];
      if (value === null || value === undefined) continue;
      if (key === 'minScore' ? typeof value === 'number' : typeof value === 'boolean') {
        (policy as Record<string, unknown>)[key] = value;
      }
    }
  }
  return policy;
}

export type VerificationEligibilityTier = 'ELIGIBLE' | 'REVIEW' | 'NOT_ELIGIBLE' | 'UNVERIFIED';

/**
 * Policy-independent summary used by the UI: whether an address can be emailed
 * as-is, needs a human decision, or must not be emailed.
 */
export function verificationEligibilityTier(
  status: VerificationStatus | string | null | undefined,
): VerificationEligibilityTier {
  switch (status) {
    case 'VERIFIED':
      return 'ELIGIBLE';
    case 'INVALID':
    case 'DISPOSABLE':
      return 'NOT_ELIGIBLE';
    case 'RISKY':
    case 'UNKNOWN':
    case 'CATCH_ALL':
    case 'ROLE_BASED':
      return 'REVIEW';
    default:
      return 'UNVERIFIED';
  }
}

/** Exclusion reasons a reviewer may override. */
export const REVIEWABLE_VERIFICATION_REASONS = new Set([
  'EMAIL_VERIFICATION_RISKY',
  'EMAIL_VERIFICATION_UNKNOWN',
  'EMAIL_VERIFICATION_CATCH_ALL',
  'EMAIL_VERIFICATION_ROLE',
  'EMAIL_VERIFICATION_LOW_SCORE',
]);

export function shouldExcludeByVerification(
  result: VerificationLike | null | undefined,
  policy: VerificationEligibilityPolicy,
): { excluded: boolean; reason?: string } {
  const outcome = exclusionFor(result, policy);
  if (outcome.excluded && policy.reviewApproved && REVIEWABLE_VERIFICATION_REASONS.has(outcome.reason!)) {
    return { excluded: false };
  }
  return outcome;
}

function exclusionFor(
  result: VerificationLike | null | undefined,
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
  if (policy.blockCatchAll !== false && result.status === 'CATCH_ALL') {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_CATCH_ALL' };
  }
  if (policy.blockUnknown !== false && result.status === 'UNKNOWN') {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_UNKNOWN' };
  }
  if (result.status === 'ROLE_BASED' && !policy.allowRoleEmails) {
    return { excluded: true, reason: 'EMAIL_VERIFICATION_ROLE' };
  }
  if (policy.excludeHighRisk !== false) {
    const minScore = policy.minScore ?? 50;
    if (result.score < minScore || (result.riskScore ?? 0) > 50) {
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
