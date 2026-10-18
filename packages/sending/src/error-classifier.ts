import type { SendErrorCategory } from './types.js';

const AUTH_HINTS = ['auth', 'authentication', 'login', 'password', 'credentials', '535', '530'];
const RATE_LIMIT_HINTS = ['rate limit', 'quota', 'throttle', 'too many', '421', '450', '451', '454'];
const CONNECTION_HINTS = ['econnrefused', 'econnreset', 'etimedout', 'timeout', 'network', 'enotfound', 'ehostunreach'];
const BOUNCE_HINTS = ['bounce', 'undeliverable', '550', '551', '553'];
const INVALID_HINTS = ['invalid recipient', 'no such user', 'unknown recipient', '511', '512', 'mailbox unavailable'];
const PERMANENT_CODE_PREFIX = new Set(['5']);
const TEMPORARY_CODE_PREFIX = new Set(['4']);

export interface ClassifiedError {
  category: SendErrorCategory;
  retryable: boolean;
  message: string;
}

function extractSmtpCode(message: string): string | null {
  const match = /\b([245]\d{2})\b/.exec(message);
  return match?.[1] ?? null;
}

export function classifySendError(error: unknown): ClassifiedError {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown send error';
  const lower = raw.toLowerCase();
  const code = extractSmtpCode(lower);

  if (AUTH_HINTS.some((hint) => lower.includes(hint))) {
    return { category: 'AUTH', retryable: false, message: raw };
  }
  if (RATE_LIMIT_HINTS.some((hint) => lower.includes(hint))) {
    return { category: 'RATE_LIMIT', retryable: true, message: raw };
  }
  if (CONNECTION_HINTS.some((hint) => lower.includes(hint))) {
    return { category: 'CONNECTION', retryable: true, message: raw };
  }
  if (INVALID_HINTS.some((hint) => lower.includes(hint))) {
    return { category: 'INVALID_ADDRESS', retryable: false, message: raw };
  }
  if (BOUNCE_HINTS.some((hint) => lower.includes(hint))) {
    return { category: 'BOUNCE', retryable: false, message: raw };
  }

  if (code) {
    const first = code.charAt(0);
    if (PERMANENT_CODE_PREFIX.has(first)) {
      return { category: 'PERMANENT', retryable: false, message: raw };
    }
    if (TEMPORARY_CODE_PREFIX.has(first)) {
      return { category: 'TEMPORARY', retryable: true, message: raw };
    }
  }

  return { category: 'UNKNOWN', retryable: true, message: raw };
}

export function retryBackoffMs(attempt: number): number {
  const table = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  const idx = Math.min(Math.max(0, attempt - 1), table.length - 1);
  return table[idx] ?? 60_000;
}
