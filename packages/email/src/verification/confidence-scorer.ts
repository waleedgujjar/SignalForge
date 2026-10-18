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

export function scoreConfidence(input: ConfidenceInput): number {
  let score = 0;
  if (input.syntaxValid) score += 15;
  if (input.domainValid) score += 15;
  if (input.dnsResolved) score += 10;
  if (input.mxFound) score += 20;
  if (input.smtpStatus === 'ACCEPTED') score += 30;
  else if (input.smtpStatus === 'SKIPPED') score += 10;
  else if (input.smtpStatus === 'TEMPORARY_FAILURE') score += 5;
  else if (input.smtpStatus === 'TIMEOUT' || input.smtpStatus === 'UNKNOWN') score += 5;

  if (input.isDisposable) score -= 40;
  if (input.isCatchAll) score -= 20;
  if (input.isRole) score -= 5;
  if (input.smtpStatus === 'REJECTED') score -= 30;
  if (input.smtpStatus === 'BLOCKED') score -= 15;

  return Math.max(0, Math.min(100, score));
}
