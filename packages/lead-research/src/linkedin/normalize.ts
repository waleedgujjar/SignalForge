/// Turns a provider's raw hits into a ResearchOutcome.
///
/// Confidence is derived from evidence, never asserted by the provider:
///   HIGH    — at least one VERIFIED entry (a human confirmed it)
///   MEDIUM  — at least two entries observed with confidence ≥ 0.6
///   LOW     — anything at all was observed
///   UNKNOWN — nothing
/// then capped at PROVIDER_MAX_CONFIDENCE so an unauthenticated public read can
/// never present itself as HIGH. Status is COMPLETED only when the core field
/// (company name / person full name) plus at least one more observed field
/// exist; a name alone is PARTIAL so the UI never implies a full profile.

import type { ResearchConfidence } from '@signalforge/database';

import type { ResearchProvenanceEntry, ResearchSuccessOutcome } from '../types.js';
import { PROVIDER_MAX_CONFIDENCE } from './types.js';
import type { LinkedInProviderName, LinkedInResearchData } from './types.js';

const CONFIDENCE_RANK: Record<ResearchConfidence, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const CORE_FIELDS = new Set(['company.name', 'person.fullName']);

/// The URL the researcher supplied is echoed into the data for display but is
/// not evidence of anything about the lead, so it counts towards neither the
/// "core + one more" rule nor the "no hits" check.
const URL_ECHO_FIELDS = new Set(['company.url', 'person.profileUrl']);

export function isEvidenceField(field: string): boolean {
  return !URL_ECHO_FIELDS.has(field);
}

export function minConfidence(a: ResearchConfidence, b: ResearchConfidence): ResearchConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function calculateConfidence(
  provenance: ResearchProvenanceEntry[],
  provider: LinkedInProviderName | string,
): ResearchConfidence {
  const evidence = provenance.filter((entry) => isEvidenceField(entry.field));
  let result: ResearchConfidence;
  if (evidence.some((entry) => entry.verification === 'VERIFIED')) {
    result = 'HIGH';
  } else if (evidence.filter((entry) => entry.confidence >= 0.6).length >= 2) {
    result = 'MEDIUM';
  } else if (evidence.length >= 1) {
    result = 'LOW';
  } else {
    result = 'UNKNOWN';
  }
  const cap = PROVIDER_MAX_CONFIDENCE[provider as LinkedInProviderName];
  return cap ? minConfidence(result, cap) : result;
}

/// Deep-removes undefined / null / empty strings and empty objects so the
/// persisted structuredData only ever contains fields with a value.
export function stripEmptyFields<T>(value: T): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim().length === 0 ? undefined : (value.trim() as unknown as T);
  if (Array.isArray(value)) {
    const items = value.map((item) => stripEmptyFields(item)).filter((item) => item !== undefined);
    return items.length === 0 ? undefined : (items as unknown as T);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripEmptyFields(entry);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length === 0 ? undefined : (result as T);
  }
  return value;
}

export function buildSummary(data: LinkedInResearchData): string {
  const parts: string[] = [];
  if (data.person?.fullName) {
    let line = data.person.fullName;
    if (data.person.title) line += ` — ${data.person.title}`;
    if (data.person.company) line += ` at ${data.person.company}`;
    parts.push(line);
    if (data.person.location) parts.push(data.person.location);
  }
  if (data.company?.name) {
    const bits = [data.company.name, data.company.industry, data.company.employeeRange, data.company.location].filter(
      (bit): bit is string => Boolean(bit),
    );
    parts.push(bits.join(' · '));
    if (data.company.tagline) parts.push(data.company.tagline);
  }
  const signals = data.signals ?? {};
  const active = Object.entries(signals)
    .filter(([, on]) => on === true)
    .map(([key]) => key);
  if (active.length > 0) parts.push(`Signals: ${active.join(', ')}`);
  return parts.join(' | ').slice(0, 500);
}

export interface NormalizeOptions {
  provider: LinkedInProviderName;
  maxConfidence?: ResearchConfidence;
  raw?: Record<string, unknown>;
}

export function normalizeOutcome(
  data: LinkedInResearchData,
  provenance: ResearchProvenanceEntry[],
  options: NormalizeOptions,
): ResearchSuccessOutcome {
  const cleaned = stripEmptyFields(data) ?? {};
  const fields = provenance.map((entry) => entry.field);
  const hasCore = fields.some((field) => CORE_FIELDS.has(field));
  const supporting = fields.filter((field) => !CORE_FIELDS.has(field) && isEvidenceField(field));

  let confidence = calculateConfidence(provenance, options.provider);
  if (options.maxConfidence) confidence = minConfidence(confidence, options.maxConfidence);

  const outcome: ResearchSuccessOutcome = {
    status: hasCore && supporting.length >= 1 ? 'COMPLETED' : 'PARTIAL',
    provider: options.provider,
    data: cleaned as unknown as Record<string, unknown>,
    provenance,
    confidence,
    summary: buildSummary(cleaned),
  };
  if (options.raw) outcome.raw = options.raw;
  return outcome;
}
