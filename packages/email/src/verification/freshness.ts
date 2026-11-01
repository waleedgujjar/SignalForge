import { VERIFICATION_VERSION } from './verification-engine.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Results that reflect a transient condition are trusted for a shorter time. */
const TRANSIENT_REASONS = new Set([
  'DNS_FAILURE',
  'DNS_TIMEOUT',
  'SMTP_TIMEOUT',
  'SMTP_TEMPORARY_FAILURE',
  'SMTP_UNAVAILABLE',
  'SMTP_BLOCKED',
  'UNKNOWN_MAILBOX',
]);

/**
 * How long a stored result may be reused: EMAIL_VERIFICATION_CACHE_TTL_DAYS
 * (default 7) for definitive results, at most one day for an UNKNOWN caused by
 * a transient condition.
 */
export function verificationCacheTtlMs(status: string, reasonCode?: string | null): number {
  const days = Number(process.env.EMAIL_VERIFICATION_CACHE_TTL_DAYS ?? 7);
  const fullTtl = (Number.isFinite(days) && days > 0 ? days : 7) * DAY_MS;
  if (status === 'UNKNOWN' && (!reasonCode || TRANSIENT_REASONS.has(reasonCode))) {
    return Math.min(fullTtl, DAY_MS);
  }
  return fullTtl;
}

/** True when a stored result is recent enough, and from the current engine, to reuse. */
export function isVerificationFresh(
  row: { status: string; reasonCode?: string | null; verifiedAt?: Date | string | null; verificationVersion?: string | null },
  now = Date.now(),
): boolean {
  if (!row.verifiedAt || row.verificationVersion !== VERIFICATION_VERSION) return false;
  const at = row.verifiedAt instanceof Date ? row.verifiedAt.getTime() : Date.parse(row.verifiedAt);
  return now - at < verificationCacheTtlMs(row.status, row.reasonCode);
}
