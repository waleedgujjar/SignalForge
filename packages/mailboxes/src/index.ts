export {
  MailboxService,
  type CreateMailboxInput,
  type UpdateMailboxInput,
} from './mailbox-service.js';
export { MailboxConnectionService } from './connection.js';
export {
  MailboxEligibilityService,
  mailboxEligibilityService,
  evaluateMailboxEligibility,
  type MailboxLike,
} from './eligibility.js';
export { MailboxUsageService, mailboxUsageService, computeUsageDate } from './usage.js';
export { logMailboxActivity } from './activity.js';
export {
  normalizeSmtpError,
  smtpCategoryMessage,
  type SmtpErrorCategory,
  type NormalizedSmtpError,
} from './smtp-errors.js';
export type {
  EligibilityReason,
  EligibilityResult,
  UsageSummary,
  RemainingCapacity,
  ConnectionTestInput,
  ConnectionTestOutcome,
  MailboxWithRelations,
} from './types.js';
