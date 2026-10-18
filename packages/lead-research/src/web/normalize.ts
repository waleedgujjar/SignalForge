/// Turns a web provider's raw hits into a ResearchOutcome.
///
/// Confidence rules mirror linkedin/normalize.ts:
///   HIGH    — at least one VERIFIED entry
///   MEDIUM  — at least two entries with confidence ≥ 0.6
///   LOW     — anything observed
///   UNKNOWN — nothing
/// Capped by WEB_PROVIDER_MAX_CONFIDENCE (website = MEDIUM, manual = HIGH).

import type { ResearchConfidence } from '@signalforge/database';

import type { ResearchProvenanceEntry, ResearchSuccessOutcome } from '../types.js';
import { stripEmptyFields } from '../linkedin/normalize.js';
import { WEB_PROVIDER_MAX_CONFIDENCE } from './types.js';
import type { WebProviderName, WebResearchData } from './types.js';

const CONFIDENCE_RANK: Record<ResearchConfidence, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const CORE_FIELDS = new Set(['company.name', 'company.description']);

const URL_ECHO_FIELDS = new Set(['source.url']);

function isEvidenceField(field: string): boolean {
  return !URL_ECHO_FIELDS.has(field);
}

function minConfidence(a: ResearchConfidence, b: ResearchConfidence): ResearchConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function calculateWebConfidence(
  provenance: ResearchProvenanceEntry[],
  provider: WebProviderName,
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
  const cap = WEB_PROVIDER_MAX_CONFIDENCE[provider];
  return cap ? minConfidence(result, cap) : result;
}

export function buildWebSummary(data: WebResearchData): string {
  const parts: string[] = [];
  if (data.company?.name) {
    const bits = [data.company.name, data.company.location].filter(Boolean);
    parts.push(bits.join(' · '));
    if (data.company.description) {
      parts.push(data.company.description.slice(0, 150));
    }
  }
  if (data.company?.services && data.company.services.length > 0) {
    parts.push(`Services: ${data.company.services.slice(0, 5).join(', ')}`);
  }
  return parts.join(' | ').slice(0, 500);
}

export interface NormalizeWebOptions {
  provider: WebProviderName;
  maxConfidence?: ResearchConfidence;
  raw?: Record<string, unknown>;
}

export function normalizeWebOutcome(
  data: WebResearchData,
  provenance: ResearchProvenanceEntry[],
  options: NormalizeWebOptions,
): ResearchSuccessOutcome {
  const cleaned = (stripEmptyFields(data) ?? {}) as WebResearchData;
  const fields = provenance.map((entry) => entry.field);
  const hasCore = fields.some((field) => CORE_FIELDS.has(field));
  const supporting = fields.filter((field) => !CORE_FIELDS.has(field) && isEvidenceField(field));

  let confidence = calculateWebConfidence(provenance, options.provider);
  if (options.maxConfidence) confidence = minConfidence(confidence, options.maxConfidence);

  const outcome: ResearchSuccessOutcome = {
    status: hasCore && supporting.length >= 1 ? 'COMPLETED' : 'PARTIAL',
    provider: options.provider,
    data: cleaned as unknown as Record<string, unknown>,
    provenance,
    confidence,
    summary: buildWebSummary(cleaned),
  };
  if (options.raw) outcome.raw = options.raw;
  return outcome;
}
