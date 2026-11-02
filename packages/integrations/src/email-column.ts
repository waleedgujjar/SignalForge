// Finding the email column in an uploaded spreadsheet and extracting addresses
// from it. Used by bulk email verification (upload, preview and export).
//
// Two rules keep unrelated columns out of verification:
// 1. A cell counts as an email only if the whole value is one address (after
//    trimming, "mailto:" and "Name <a@b.com>" unwrapping). URLs never qualify:
//    a Google Maps link such as ".../place/acme+tx/@29.66,-98.4" contains an
//    "@" but is not an email.
// 2. Columns are chosen by header name first (a fixed priority list), and by
//    content only when no header is recognized.

import { normalizeHeader } from './column-detector.js';

/**
 * Recognized email headers, strongest first. Compared after normalization
 * (case, spaces, "_" and "-" ignored), so "EMAIL_ADDRESS", "E-mail" and
 * " email address " all match.
 */
export const EMAIL_HEADER_PRIORITY = [
  'email',
  'email address',
  'business email',
  'work email',
  'company email',
  'gmail',
  'google mail',
  'contact email',
  'primary email',
  'personal email',
  'email id',
  'emails',
  'mail',
  'contact',
] as const;

/** Headers that only count when most of their values are real emails. */
const WEAK_HEADERS = new Set(['contact', 'mail']);
/** Rank for a header that mentions "email" but is not in the list ("Owner Email"). */
const GENERIC_EMAIL_RANK = EMAIL_HEADER_PRIORITY.length;
/** Rank for a column picked only because its values are emails. */
const CONTENT_ONLY_RANK = GENERIC_EMAIL_RANK + 1;
const SAMPLE_ROWS = 500;
const CONTENT_MIN_VALID_RATIO = 0.5;

export function normalizeEmailHeader(header: string): string {
  return normalizeHeader(header)
    .replace(/\be mail\b/g, 'email')
    .replace(/\bemailaddress\b/g, 'email address')
    .replace(/\bemailid\b/g, 'email id')
    .replace(/\bg mail\b/g, 'gmail')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerRank(header: string): number | null {
  const normalized = normalizeEmailHeader(header);
  const index = (EMAIL_HEADER_PRIORITY as readonly string[]).indexOf(normalized);
  if (index !== -1) return index;
  if (/\b(email|gmail)\b/.test(normalized)) return GENERIC_EMAIL_RANK;
  return null;
}

// Local part: no "/" or ":" (so URL paths cannot pass); domain: labels plus an
// alphabetic TLD (so "@29.66927" coordinates cannot pass).
const EMAIL_EXACT =
  /^[a-z0-9!#$%&'*+=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export type EmailCellResult =
  | { status: 'valid'; email: string }
  | { status: 'invalid'; raw: string }
  | { status: 'empty' };

/**
 * Parses one cell. Returns the normalized address only when the cell holds an
 * email (optionally as "mailto:x", "Name <x>", or one of several separated by
 * "," or ";"). URLs, bare domains and malformed values are invalid.
 */
export function parseEmailCell(value: string | null | undefined): EmailCellResult {
  const raw = (value ?? '').trim();
  if (!raw) return { status: 'empty' };
  if (/:\/\/|^www\./i.test(raw)) return { status: 'invalid', raw };

  for (const part of raw.split(/[;,]/)) {
    let candidate = part.trim();
    const angled = /<([^<>]+)>\s*$/.exec(candidate);
    if (angled) candidate = angled[1]!.trim();
    candidate = candidate.replace(/^mailto:/i, '').replace(/\?.*$/, '').trim();
    if (EMAIL_EXACT.test(candidate)) return { status: 'valid', email: candidate.toLowerCase() };
  }
  return { status: 'invalid', raw };
}

export interface EmailColumnCandidate {
  header: string;
  /** How the column was recognized. */
  reason: 'header' | 'header-generic' | 'content';
  /** Lower is stronger. */
  rank: number;
  /** Counts over the sampled rows. */
  valid: number;
  invalid: number;
  empty: number;
}

export interface EmailColumnDetection {
  /** Usable candidates, best first. */
  candidates: EmailColumnCandidate[];
  selected: string | null;
  /** Another candidate is as strong as the selected one; the user should confirm. */
  ambiguous: boolean;
}

export function detectEmailColumns(headers: string[], rows: Record<string, string>[]): EmailColumnDetection {
  const sample = rows.slice(0, SAMPLE_ROWS);
  const candidates: EmailColumnCandidate[] = [];

  for (const header of headers) {
    let valid = 0;
    let invalid = 0;
    let empty = 0;
    for (const row of sample) {
      const parsed = parseEmailCell(row[header]);
      if (parsed.status === 'valid') valid++;
      else if (parsed.status === 'invalid') invalid++;
      else empty++;
    }
    const filled = valid + invalid;
    const mostlyEmails = valid > 0 && valid / Math.max(1, filled) >= CONTENT_MIN_VALID_RATIO;
    const rank = headerRank(header);

    if (rank !== null && !(WEAK_HEADERS.has(normalizeEmailHeader(header)) && !mostlyEmails)) {
      candidates.push({ header, reason: rank === GENERIC_EMAIL_RANK ? 'header-generic' : 'header', rank, valid, invalid, empty });
    } else if (rank === null && mostlyEmails) {
      candidates.push({ header, reason: 'content', rank: CONTENT_ONLY_RANK, valid, invalid, empty });
    }
  }

  // Columns that actually contain emails first, then by header strength, then
  // by how many valid emails they hold.
  candidates.sort((a, b) => Number(b.valid > 0) - Number(a.valid > 0) || a.rank - b.rank || b.valid - a.valid);
  const best = candidates.find((c) => c.valid > 0) ?? null;
  const ambiguous = Boolean(best && candidates.some((c) => c !== best && c.valid > 0 && c.rank === best.rank));
  // A recognized email header with no valid values is still the email column;
  // selecting it lets the caller say "no valid emails in Email" instead of
  // "no email column".
  const selected = best ?? candidates.find((c) => c.reason === 'header') ?? null;
  return { candidates, selected: selected?.header ?? null, ambiguous };
}

export interface EmailExtraction {
  column: string;
  rowCount: number;
  /** Rows that produced a valid email (from the column or a fallback column). */
  validRows: number;
  /** Rows whose value was present but not an email (e.g. a URL). */
  invalidRows: number;
  emptyRows: number;
  /** Rows filled from another email column because the chosen one was empty. */
  fallbackRows: number;
  duplicateEmails: number;
  emails: string[];
  preview: string[];
  invalidSamples: string[];
}

/**
 * Extracts unique, valid emails from `column`. When that cell is empty, the
 * other recognized email columns (`fallbackColumns`, in order) are tried.
 */
export function extractEmailsFromRows(
  rows: Record<string, string>[],
  column: string,
  fallbackColumns: string[] = [],
): EmailExtraction {
  const seen = new Set<string>();
  const result: EmailExtraction = {
    column,
    rowCount: rows.length,
    validRows: 0,
    invalidRows: 0,
    emptyRows: 0,
    fallbackRows: 0,
    duplicateEmails: 0,
    emails: [],
    preview: [],
    invalidSamples: [],
  };

  for (const row of rows) {
    let parsed = parseEmailCell(row[column]);
    if (parsed.status === 'empty') {
      for (const other of fallbackColumns) {
        const alt = parseEmailCell(row[other]);
        if (alt.status === 'valid') {
          parsed = alt;
          result.fallbackRows++;
          break;
        }
      }
    }
    if (parsed.status === 'empty') {
      result.emptyRows++;
      continue;
    }
    if (parsed.status === 'invalid') {
      result.invalidRows++;
      if (result.invalidSamples.length < 3) result.invalidSamples.push(parsed.raw.slice(0, 120));
      continue;
    }
    result.validRows++;
    if (seen.has(parsed.email)) {
      result.duplicateEmails++;
      continue;
    }
    seen.add(parsed.email);
    result.emails.push(parsed.email);
    if (result.preview.length < 5) result.preview.push(parsed.email);
  }
  return result;
}
