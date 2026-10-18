import type { JobLogContext } from '@signalforge/shared';

const REDACT_KEYS = new Set(['password', 'smtppassword', 'secret', 'token', 'encryptedpayload']);

export function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACT_KEYS.has(key.toLowerCase())) continue;
    clean[key] = value;
  }
  return clean;
}

export function logSendingEvent(message: string, context: JobLogContext & Record<string, unknown>): void {
  const payload = { message, ...sanitizeMetadata(context), timestamp: new Date().toISOString() };
  console.info(JSON.stringify(payload));
}
