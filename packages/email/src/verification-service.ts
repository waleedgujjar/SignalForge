import { emailVerificationEngine } from './verification/verification-engine.js';
import {
  shouldExcludeByVerification,
  type VerificationEligibilityPolicy,
} from './verification/eligibility.js';
import type { VerificationResult, VerifyEmailOptions } from './verification/types.js';

export type {
  VerificationStatus,
  VerificationResult,
  VerifyEmailOptions,
  RiskLevel,
  ProviderType,
} from './verification/types.js';

export {
  emailVerificationEngine,
  EmailVerificationEngine,
  shouldExcludeByVerification,
  type VerificationEligibilityPolicy,
} from './verification/index.js';

export async function verifyEmail(email: string): Promise<{
  email: string;
  status: VerificationResult['status'];
  score: number;
  reason: string;
  domain: string;
  mxStatus: string;
}> {
  const result = await emailVerificationEngine.verify(email);
  return {
    email: result.email,
    status: result.status,
    score: result.score,
    reason: result.reason,
    domain: result.domain,
    mxStatus: result.mxStatus,
  };
}

export async function verifyEmailFull(
  email: string,
  options?: VerifyEmailOptions,
): Promise<VerificationResult> {
  return emailVerificationEngine.verify(email, options);
}

export function shouldExcludeByPolicy(
  result: Pick<VerificationResult, 'email' | 'status' | 'score' | 'reason' | 'domain' | 'mxStatus' | 'riskScore' | 'riskLevel'>,
  policy: VerificationEligibilityPolicy,
): boolean {
  const full = result as VerificationResult;
  return shouldExcludeByVerification(full, policy).excluded;
}
