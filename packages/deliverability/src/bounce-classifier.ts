import type { BounceType } from './types.js';

/**
 * Normalizes provider SMTP rejections into a hard/soft bounce classification.
 *
 * Providers word their responses differently, so classification is conservative:
 * a rejection is only treated as HARD when the response is unambiguously
 * permanent (5.x.x enhanced status, 5yz reply code, or an explicit
 * invalid-recipient phrase). Anything temporary or ambiguous stays SOFT so a
 * transient outage never permanently suppresses a real address.
 */

export interface SmtpResponseDetails {
  /// Basic reply code, e.g. "550".
  statusCode: string | null;
  /// Enhanced status code, e.g. "5.1.1".
  enhancedStatusCode: string | null;
  /// Raw provider text, trimmed.
  response: string;
}

export interface BounceClassification extends SmtpResponseDetails {
  bounceType: BounceType | null;
  /// True when the rejection is a delivery bounce rather than an infrastructure
  /// or authentication problem on our side.
  isBounce: boolean;
  reason: string;
}

const HARD_PHRASES = [
  'no such user',
  'user unknown',
  'unknown user',
  'invalid recipient',
  'recipient rejected',
  'recipient address rejected',
  'unknown recipient',
  'address does not exist',
  'does not exist',
  'no mailbox here',
  'mailbox not found',
  'unrouteable address',
  'domain not found',
  'nonexistent',
  'account has been disabled',
  'account is disabled',
  'user is terminated',
];

const SOFT_PHRASES = [
  'mailbox full',
  'over quota',
  'quota exceeded',
  'insufficient storage',
  'temporarily unavailable',
  'temporary failure',
  'try again later',
  'greylist',
  'greylisted',
  'deferred',
  'too many connections',
  'service unavailable',
  'resources temporarily unavailable',
  'server busy',
];

/// Rejections that indicate our own configuration or connectivity is broken,
/// not that the recipient address is bad.
const NON_BOUNCE_PHRASES = [
  'authentication failed',
  'authentication required',
  'invalid credentials',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'ehostunreach',
  'certificate',
  'tls',
];

export function extractSmtpResponse(error: unknown): SmtpResponseDetails {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown send error';
  const response = raw.trim();
  const enhanced = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(response);
  const basic = /\b([245]\d{2})\b/.exec(response);

  return {
    statusCode: basic?.[1] ?? null,
    enhancedStatusCode: enhanced?.[0] ?? null,
    response: response.slice(0, 1000),
  };
}

export function classifyBounce(error: unknown): BounceClassification {
  const details = extractSmtpResponse(error);
  const lower = details.response.toLowerCase();

  if (NON_BOUNCE_PHRASES.some((phrase) => lower.includes(phrase))) {
    return {
      ...details,
      bounceType: null,
      isBounce: false,
      reason: 'Infrastructure or authentication failure, not a recipient bounce.',
    };
  }

  if (SOFT_PHRASES.some((phrase) => lower.includes(phrase))) {
    return { ...details, bounceType: 'SOFT', isBounce: true, reason: 'Temporary recipient-side rejection.' };
  }

  if (HARD_PHRASES.some((phrase) => lower.includes(phrase))) {
    return { ...details, bounceType: 'HARD', isBounce: true, reason: 'Permanent recipient rejection.' };
  }

  const enhancedClass = details.enhancedStatusCode?.charAt(0) ?? null;
  if (enhancedClass === '5') {
    return { ...details, bounceType: 'HARD', isBounce: true, reason: 'Permanent enhanced status code (5.x.x).' };
  }
  if (enhancedClass === '4') {
    return { ...details, bounceType: 'SOFT', isBounce: true, reason: 'Temporary enhanced status code (4.x.x).' };
  }

  const basicClass = details.statusCode?.charAt(0) ?? null;
  if (basicClass === '5') {
    return { ...details, bounceType: 'HARD', isBounce: true, reason: 'Permanent SMTP reply code (5yz).' };
  }
  if (basicClass === '4') {
    return { ...details, bounceType: 'SOFT', isBounce: true, reason: 'Temporary SMTP reply code (4yz).' };
  }

  return {
    ...details,
    bounceType: null,
    isBounce: false,
    reason: 'Response could not be classified as a bounce.',
  };
}

/**
 * Bridges the Module 9 error categories to a bounce type. `INVALID_ADDRESS` is
 * always hard; `BOUNCE` defers to the response text so a 4yz "bounce" stays soft.
 */
export function classifyBounceFromCategory(
  category: string,
  error: unknown,
): BounceClassification {
  const classification = classifyBounce(error);

  if (category === 'INVALID_ADDRESS') {
    return { ...classification, bounceType: 'HARD', isBounce: true, reason: 'Invalid recipient address.' };
  }
  if (category === 'BOUNCE' && !classification.isBounce) {
    return { ...classification, bounceType: 'SOFT', isBounce: true, reason: 'Unclassified bounce treated as soft.' };
  }
  return classification;
}
