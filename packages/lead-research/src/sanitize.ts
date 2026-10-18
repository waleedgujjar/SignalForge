/// Credential scrubbing for anything that leaves a provider: doctor output,
/// raw page previews, API responses.
///
/// SignalForge never stores LinkedIn cookies, tokens or session material, but
/// external tools print them freely (Agent-Reach's doctor, a reader's error
/// body). Rather than trusting each caller to remember, every string that is
/// persisted or displayed passes through here. The rules are deliberately
/// blunt — an opaque 32+ character run is redacted even if it was harmless —
/// because a false positive costs a few characters of a log line while a false
/// negative leaks a session.

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = new RegExp('\x1b\\[[0-9;?]*[A-Za-z]', 'g');

/// `li_at=…`, `JSESSIONID: "…"`, `api_key = …`, `Authorization: …`.
/// The value may be quoted, bare, or (for headers) the rest of the line.
const KEY_VALUE_SECRETS =
  /\b(li_at|liap|JSESSIONID|bcookie|bscookie|lidc|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|secret|client[_-]?secret|cookie|set-cookie|password|passwd|pwd|authorization|x-api-key)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;,]+)/gi;

const BEARER_TOKENS = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/// LinkedIn's own opaque identifiers (URNs, tracking ids) start with `AQ`.
const LINKEDIN_OPAQUE_IDS = /\bAQ[A-Za-z0-9_-]{20,}/g;

/// Any long run of token-like characters. `/`, `.` and `:` break a run, so
/// ordinary URLs survive intact; a raw session cookie or key does not.
const OPAQUE_RUNS = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;

/// SHA-256 digests are 64 lowercase hex characters; this codebase stores them
/// as `inputHash` and they carry no secret, so they are the one exemption.
const SHA256_HEX = /^[0-9a-f]{64}$/;

const REDACTED = '[REDACTED]';

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPES, '');
}

/// Redact secrets inside a single string. Safe on non-ASCII text: the rules
/// only match ASCII key names and token runs, everything else passes through.
export function sanitizeSecrets(text: string): string {
  if (!text) return text;
  return stripAnsi(text)
    .replace(KEY_VALUE_SECRETS, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(BEARER_TOKENS, `Bearer ${REDACTED}`)
    .replace(LINKEDIN_OPAQUE_IDS, REDACTED)
    .replace(OPAQUE_RUNS, (run: string) => (SHA256_HEX.test(run) ? run : REDACTED));
}

const MAX_DOCTOR_LINES = 20;
const MAX_DOCTOR_LINE_LENGTH = 200;

/// Turn free-form CLI output into a bounded list of safe lines for `details`.
export function sanitizeDoctorOutput(text: string): string[] {
  if (!text) return [];
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => sanitizeSecrets(line).trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_DOCTOR_LINES)
    .map((line) => (line.length > MAX_DOCTOR_LINE_LENGTH ? `${line.slice(0, MAX_DOCTOR_LINE_LENGTH - 1)}…` : line));
}

/// Object keys whose values are dropped outright, whatever they contain.
const SECRET_KEY_PATTERN = /token|cookie|password|secret|li_at|api[_-]?key|authorization|bearer/i;

/// Deep-walk any JSON-ish value: drop secret-named keys, sanitize every string.
/// Dates and other class instances are passed through untouched so Prisma rows
/// survive the walk; only plain objects and arrays are rebuilt.
export function stripSecrets<T>(value: T): T {
  return walk(value, 0) as T;
}

const MAX_DEPTH = 32;

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') return sanitizeSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    result[key] = walk(entry, depth + 1);
  }
  return result;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
