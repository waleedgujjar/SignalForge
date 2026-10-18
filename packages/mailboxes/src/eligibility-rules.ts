import type { EligibilityContext, EligibilityReason, EligibilityResult } from './types.js';

const REASON_MESSAGES: Record<EligibilityReason, string> = {
  ELIGIBLE: 'Eligible for sending.',
  UNVERIFIED: 'Account has not passed a successful connection test.',
  DISABLED: 'Account is disabled.',
  PAUSED: 'Account is paused.',
  ERROR: 'Account is in an error state. Test the connection to resolve.',
  DISCONNECTED: 'Account is disconnected.',
  UNHEALTHY: 'Account health is critical.',
  DAILY_LIMIT_EXHAUSTED: 'Daily sending limit reached.',
  MISSING_CREDENTIALS: 'Account is missing SMTP credentials.',
};

export interface MailboxLike {
  status: string;
  healthStatus: string;
  dailySendingLimit: number;
  currentDailyUsage: number;
  verifiedAt: Date | null;
  smtpHost: string | null;
  smtpPort: number | null;
}

export function evaluateMailboxEligibility(
  mailbox: MailboxLike & { credential?: unknown },
  _context: EligibilityContext = {},
): EligibilityResult {
  const remaining = Math.max(0, mailbox.dailySendingLimit - mailbox.currentDailyUsage);
  const base = { remainingToday: remaining };

  if (mailbox.status === 'DISABLED') {
    return { eligible: false, reason: 'DISABLED', message: REASON_MESSAGES.DISABLED, ...base };
  }
  if (mailbox.status === 'UNVERIFIED' || !mailbox.verifiedAt) {
    return { eligible: false, reason: 'UNVERIFIED', message: REASON_MESSAGES.UNVERIFIED, ...base };
  }
  if (mailbox.status === 'PAUSED') {
    return { eligible: false, reason: 'PAUSED', message: REASON_MESSAGES.PAUSED, ...base };
  }
  if (mailbox.status === 'ERROR') {
    return { eligible: false, reason: 'ERROR', message: REASON_MESSAGES.ERROR, ...base };
  }
  if (mailbox.status === 'DISCONNECTED') {
    return { eligible: false, reason: 'DISCONNECTED', message: REASON_MESSAGES.DISCONNECTED, ...base };
  }
  if (mailbox.healthStatus === 'UNHEALTHY') {
    return { eligible: false, reason: 'UNHEALTHY', message: REASON_MESSAGES.UNHEALTHY, ...base };
  }
  if (!mailbox.smtpHost || !mailbox.smtpPort) {
    return {
      eligible: false,
      reason: 'MISSING_CREDENTIALS',
      message: REASON_MESSAGES.MISSING_CREDENTIALS,
      ...base,
    };
  }
  if (remaining <= 0) {
    return {
      eligible: false,
      reason: 'DAILY_LIMIT_EXHAUSTED',
      message: REASON_MESSAGES.DAILY_LIMIT_EXHAUSTED,
      ...base,
    };
  }
  return { eligible: true, reason: 'ELIGIBLE', message: REASON_MESSAGES.ELIGIBLE, ...base };
}
