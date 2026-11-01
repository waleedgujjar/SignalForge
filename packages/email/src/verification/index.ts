export * from './types.js';
export { normalizeEmail } from './normalizer.js';
export { validateSyntax } from './syntax-validator.js';
export { validateDomain } from './domain-validator.js';
export { verifyMx } from './mx-verifier.js';
export { getDefaultDisposableProvider } from './disposable-provider.js';
export { detectRoleEmail } from './role-detector.js';
export { detectProviderType } from './provider-detector.js';
export { verifySmtpRecipient, detectCatchAll, classifyRcptReply, isSmtpUnavailable } from './smtp-verifier.js';
export { scoreRisk } from './risk-scorer.js';
export { scoreConfidence } from './confidence-scorer.js';
export { reasonMessage } from './reason-codes.js';
export { EmailVerificationEngine, emailVerificationEngine, VERIFICATION_VERSION } from './verification-engine.js';
export {
  shouldExcludeByVerification,
  resolveVerificationPolicy,
  verificationEligibilityTier,
  REVIEWABLE_VERIFICATION_REASONS,
  type VerificationEligibilityPolicy,
  type VerificationEligibilityTier,
  type VerificationLike,
} from './eligibility.js';
export { isVerificationFresh, verificationCacheTtlMs } from './freshness.js';
