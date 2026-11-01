import type { SmtpInternalStatus } from './types.js';

export interface ConfidenceInput {
  syntaxValid: boolean;
  domainValid: boolean;
  dnsResolved: boolean;
  mxFound: boolean;
  smtpStatus: SmtpInternalStatus;
  isDisposable: boolean;
  isCatchAll: boolean;
  isRole: boolean;
}

/**
 * How strongly the evidence supports "this address will receive mail" (0-100).
 * Only an SMTP acceptance from a non-catch-all server reaches the top band.
 */
export function scoreConfidence(input: ConfidenceInput): number {
  let score = 0;
  if (input.syntaxValid) score += 15;
  if (input.domainValid) score += 15;
  if (input.dnsResolved) score += 5;
  if (input.mxFound) score += 25;
  if (input.smtpStatus === 'ACCEPTED') score += input.isCatchAll ? 10 : 40;
  else if (input.smtpStatus === 'MAILBOX_FULL') score += 5;

  if (input.isDisposable) score -= 40;
  if (input.isRole) score -= 5;
  if (input.smtpStatus === 'REJECTED') score -= 60;

  return Math.max(0, Math.min(100, score));
}
