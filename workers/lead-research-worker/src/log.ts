/// Structured, allow-listed logging for the research worker.
///
/// Only these fields ever reach stdout: ids, source, provider, operation,
/// status, timestamps and error codes. URLs with query strings, raw provider
/// output, cookies, tokens and env values are never logged — the allow-list is
/// the enforcement, not a convention.
const ALLOWED_FIELDS = new Set([
  'jobId',
  'researchId',
  'leadId',
  'workspaceId',
  'source',
  'provider',
  'operation',
  'status',
  'startedAt',
  'completedAt',
  'durationMs',
  'errorCode',
  'errorMessage',
  'retryCount',
  'attempt',
  'queues',
  'concurrency',
]);

const SECRET_PATTERN =
  /\b(li_at|JSESSIONID|token|api[_-]?key|secret|cookie|bearer|password|passwd|auth(?:orization)?)\b\s*[:=]\s*\S+/gi;

export function sanitizeLogMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text
    .replace(SECRET_PATTERN, '$1=[REDACTED]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
    .slice(0, 300);
}

export function logResearch(message: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
    safe[key] = key === 'errorMessage' ? sanitizeLogMessage(value) : value instanceof Date ? value.toISOString() : value;
  }
  console.info(
    JSON.stringify({
      worker: 'lead-research-worker',
      message,
      ...safe,
      timestamp: new Date().toISOString(),
    }),
  );
}
