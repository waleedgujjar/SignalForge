import type { SendErrorCategory } from './types.js';

export interface ClassifiedError {
  category: SendErrorCategory;
  retryable: boolean;
  message: string;
}

/** Fields nodemailer (and most SMTP clients) attach to a send error. */
interface SmtpErrorLike {
  code?: string;
  responseCode?: number;
  response?: string;
}

const TRANSPORT_CONNECTION_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

const CONNECTION_TEXT = /\b(econnrefused|econnreset|etimedout|enotfound|ehostunreach|socket hang up|connection (?:timed out|closed|refused)|network error)\b|\btimeout\b/i;
const AUTH_TEXT = /\b(authentication (?:failed|unsuccessful|required)|invalid login|username and password not accepted|bad credentials|login (?:failed|denied))\b/i;
// The recipient domain rejected us because SPF/DKIM/DMARC did not pass. A
// sender-side configuration problem that will fail every message: stop, don't retry.
const SENDER_AUTH_TEXT = /\b(unauthenticated|not authenticated|dmarc|spf|dkim)\b/i;
const RATE_TEXT = /\b(rate limit|too many|too quickly|throttl|try again later|sending quota|daily (?:user )?sending quota|limit exceeded)\b/i;
const INVALID_TEXT = /\b(no such user|user unknown|unknown (?:user|recipient)|invalid recipient|recipient (?:not found|rejected|address rejected)|mailbox (?:unavailable|not found)|does not exist|address rejected)\b/i;
const MAILBOX_FULL_TEXT = /\b(mailbox (?:is )?full|over ?quota|insufficient storage)\b/i;

function leadingCode(text: string): number | null {
  // The reply code starts the SMTP response line ("550 5.1.1 ..."), or follows
  // a short prefix such as "Server said 554". Avoid matching numbers inside ids.
  const match = /(?:^|\b(?:said|response|code|error)[:\s]+)([245]\d{2})(?=[\s-]|$)/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Maps an SMTP send error to a category and retry decision. Uses the
 * structured fields the SMTP client provides (code, responseCode, response)
 * first, and only falls back to text patterns when they are missing.
 */
export function classifySendError(error: unknown): ClassifiedError {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown send error';
  const smtp = (typeof error === 'object' && error !== null ? error : {}) as SmtpErrorLike;
  const response = smtp.response ?? raw;
  const responseCode = smtp.responseCode ?? leadingCode(response);
  const enhanced = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(response);
  const subject = enhanced ? `${enhanced[2]}.${enhanced[3]}` : null;
  const result = (category: SendErrorCategory, retryable: boolean): ClassifiedError => ({
    category,
    retryable,
    message: raw,
  });

  // Login to our own SMTP server failed.
  if (smtp.code === 'EAUTH' || responseCode === 535 || responseCode === 534 || (responseCode === 530 && AUTH_TEXT.test(response))) {
    return result('AUTH', false);
  }
  if ((smtp.code && TRANSPORT_CONNECTION_CODES.has(smtp.code)) || (responseCode === null && CONNECTION_TEXT.test(raw))) {
    return result('CONNECTION', true);
  }

  if (responseCode !== null && responseCode >= 400 && responseCode < 500) {
    if (responseCode === 452 && MAILBOX_FULL_TEXT.test(response)) return result('BOUNCE', true);
    if (responseCode === 421 || RATE_TEXT.test(response)) return result('RATE_LIMIT', true);
    return result('TEMPORARY', true);
  }

  if (responseCode !== null && responseCode >= 500) {
    if (subject === '7.26' || (enhanced?.[2] === '7' && SENDER_AUTH_TEXT.test(response))) return result('AUTH', false);
    if (subject?.startsWith('1.') || INVALID_TEXT.test(response)) return result('INVALID_ADDRESS', false);
    if (subject === '2.2' || responseCode === 552 || MAILBOX_FULL_TEXT.test(response)) return result('BOUNCE', true);
    if (subject === '4.5' || RATE_TEXT.test(response)) return result('RATE_LIMIT', true);
    // X.7.x is a policy/reputation rejection of our message, not a bad
    // recipient: it must not be treated as a bounce that suppresses the lead.
    if (enhanced?.[2] === '7') return result('PERMANENT', false);
    if (responseCode === 550 || responseCode === 551 || responseCode === 553) return result('BOUNCE', false);
    return result('PERMANENT', false);
  }

  // No SMTP code available: fall back to the message text.
  if (AUTH_TEXT.test(raw)) return result('AUTH', false);
  if (RATE_TEXT.test(raw)) return result('RATE_LIMIT', true);
  if (INVALID_TEXT.test(raw)) return result('INVALID_ADDRESS', false);
  if (/\b(bounce|undeliverable)\b/i.test(raw)) return result('BOUNCE', false);
  return result('UNKNOWN', true);
}

export function retryBackoffMs(attempt: number): number {
  const table = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  const idx = Math.min(Math.max(0, attempt - 1), table.length - 1);
  return table[idx] ?? 60_000;
}
