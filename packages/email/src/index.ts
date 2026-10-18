export { encryptSecret, decryptSecret } from './encryption.js';
export type { EncryptedPayload } from './encryption.js';

export { createSmtpProvider } from './smtp-provider.js';
export type {
  MailboxProvider,
  SmtpConfig,
  SendEmailInput,
  SendEmailResult,
  EmailProvider,
  VerifyConnectionResult,
} from './smtp-provider.js';

export { normalizeSmtpError, smtpCategoryMessage } from './smtp-errors.js';
export type { SmtpErrorCategory, NormalizedSmtpError } from './smtp-errors.js';

export {
  detectVariables,
  resolveVariables,
  validateTemplate,
  leadToVariableContext,
} from './variable-resolver.js';
export type { LeadVariableContext, VariableResolutionResult } from './variable-resolver.js';

export { parseSpintax, validateSpintax } from './spintax-parser.js';
export type { SpintaxParseOptions, SpintaxParseResult } from './spintax-parser.js';

export { verifyEmail, verifyEmailFull, shouldExcludeByPolicy } from './verification-service.js';
export type { VerificationStatus, VerificationResult, VerifyEmailOptions } from './verification-service.js';
export {
  emailVerificationEngine,
  EmailVerificationEngine,
  shouldExcludeByVerification,
  type VerificationEligibilityPolicy,
} from './verification/index.js';

export { checkSuppression, extractDomain } from './suppression-engine.js';
export type {
  SuppressionType,
  SuppressionReason,
  SuppressionEntry,
  SuppressionCheckResult,
} from './suppression-engine.js';

export { selectMailbox, resetRoundRobin } from './rotation-engine.js';
export type { RotationStrategy, HealthStatus, MailboxCandidate, RotationResult } from './rotation-engine.js';

export { evaluateSendingPolicy } from './sending-policy.js';
export type { PolicyDecision, PolicyCheckInput, PolicyCheckResult } from './sending-policy.js';

export { generateUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } from './unsubscribe-token.js';
