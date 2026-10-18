import {
  detectColumnMappings,
  buildMappingsRecord,
  normalizeHeader,
  LEAD_FIELDS,
  CUSTOM_FIELD_TARGETS,
  type LeadField,
} from './column-detector.js';
import type { ColumnMapping, LeadImportMappingResult } from './types.js';

const VALUE_SAMPLE_SIZE = 20;
const VALUE_MATCH_THRESHOLD = 0.7;

const INFERABLE_FIELDS = new Set<string>([
  'email',
  'phone',
  'website',
  'fullName',
  'company',
]);

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_PATTERN = /^(?:https?:\/\/|www\.)[^\s]+|[a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\/[^\s]*)?$/i;
const DOMAIN_PATTERN = /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}$/i;

function sampleValues(rows: Record<string, string>[], column: string, limit = VALUE_SAMPLE_SIZE): string[] {
  const values: string[] = [];
  for (const row of rows) {
    const val = row[column]?.trim();
    if (val) values.push(val);
    if (values.length >= limit) break;
  }
  return values;
}

function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim().toLowerCase().replace(/^mailto:/, ''));
}

function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Reject pure integers that are likely IDs or counts (e.g. 100000)
  if (/^\d+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;
    // Reject round numbers without formatting that look like IDs
    if (digits.length <= 6) return false;
  }
  const digits = trimmed.replace(/(?:ext|x|extension)\.?\s*\d+$/i, '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Must have some phone-like structure (parens, dashes, spaces, or +)
  const hasPhoneFormatting = /[+()\-\s]/.test(trimmed) || trimmed.startsWith('+');
  if (!hasPhoneFormatting && digits.length === 7) return false;
  return true;
}

function looksLikeWebsite(value: string): boolean {
  const trimmed = value.trim().toLowerCase().replace(/^mailto:/, '');
  if (!trimmed || trimmed.includes('@')) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^www\./i.test(trimmed)) return true;
  if (DOMAIN_PATTERN.test(trimmed.replace(/\/.*$/, ''))) return true;
  return URL_PATTERN.test(trimmed);
}

function matchRatio(values: string[], matcher: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  const matches = values.filter(matcher).length;
  return matches / values.length;
}

function inferFieldFromValues(
  values: string[],
): { field: string; confidence: number; reason: string } | null {
  const emailRatio = matchRatio(values, looksLikeEmail);
  if (emailRatio >= VALUE_MATCH_THRESHOLD) {
    return { field: 'email', confidence: emailRatio * 0.95, reason: 'value-inference:email-pattern' };
  }

  const websiteRatio = matchRatio(values, looksLikeWebsite);
  if (websiteRatio >= VALUE_MATCH_THRESHOLD) {
    return { field: 'website', confidence: websiteRatio * 0.93, reason: 'value-inference:url-pattern' };
  }

  const phoneRatio = matchRatio(values, looksLikePhone);
  if (phoneRatio >= VALUE_MATCH_THRESHOLD) {
    return { field: 'phone', confidence: phoneRatio * 0.9, reason: 'value-inference:phone-pattern' };
  }

  return null;
}

function applyOverrides(
  mappings: ColumnMapping[],
  overrides?: Record<string, string>,
): ColumnMapping[] {
  if (!overrides || Object.keys(overrides).length === 0) return mappings;

  const result = [...mappings];
  const usedFields = new Set(result.map((m) => m.leadField));

  for (const [csvColumn, leadField] of Object.entries(overrides)) {
    if (!leadField) continue;
    const existingIdx = result.findIndex((m) => m.csvColumn === csvColumn);
    if (existingIdx >= 0) {
      const oldField = result[existingIdx]!.leadField;
      usedFields.delete(oldField);
      result[existingIdx] = {
        csvColumn,
        leadField,
        confidence: 1.0,
        reason: 'manual-override',
      };
      usedFields.add(leadField);
    } else if (!usedFields.has(leadField)) {
      result.push({
        csvColumn,
        leadField,
        confidence: 1.0,
        reason: 'manual-override',
      });
      usedFields.add(leadField);
    }
  }

  return result;
}

function enrichHeaderMappings(
  headerMappings: ColumnMapping[],
  rows: Record<string, string>[],
): ColumnMapping[] {
  return headerMappings.map((mapping) => {
    const values = sampleValues(rows, mapping.csvColumn);
    if (values.length === 0) return mapping;

    let reason = mapping.reason ?? 'header-match';
    let confidence = mapping.confidence;

    if (mapping.leadField === 'email' && matchRatio(values, looksLikeEmail) >= VALUE_MATCH_THRESHOLD) {
      confidence = Math.min(0.99, confidence + 0.05);
      reason = 'header+email-pattern';
    } else if (mapping.leadField === 'phone' && matchRatio(values, looksLikePhone) >= VALUE_MATCH_THRESHOLD) {
      confidence = Math.min(0.98, confidence + 0.05);
      reason = 'header+phone-pattern';
    } else if (
      (mapping.leadField === 'website' || mapping.leadField === 'companyDomain') &&
      matchRatio(values, looksLikeWebsite) >= VALUE_MATCH_THRESHOLD
    ) {
      confidence = Math.min(0.98, confidence + 0.05);
      reason = 'header+url-pattern';
    }

    return { ...mapping, confidence, reason };
  });
}

function inferUnmappedColumns(
  headers: string[],
  existingMappings: ColumnMapping[],
  rows: Record<string, string>[],
): ColumnMapping[] {
  const mappedColumns = new Set(existingMappings.map((m) => m.csvColumn));
  const usedFields = new Set(existingMappings.map((m) => m.leadField));
  const inferred: ColumnMapping[] = [];

  for (const header of headers) {
    if (mappedColumns.has(header)) continue;

    const values = sampleValues(rows, header);
    if (values.length === 0) continue;

    const inference = inferFieldFromValues(values);
    if (!inference) continue;
    if (!INFERABLE_FIELDS.has(inference.field)) continue;
    if (usedFields.has(inference.field)) continue;

    usedFields.add(inference.field);
    mappedColumns.add(header);
    inferred.push({
      csvColumn: header,
      leadField: inference.field,
      confidence: inference.confidence,
      reason: inference.reason,
    });
  }

  return inferred;
}

/**
 * Detect column mappings using header aliases, value-pattern inference, and optional overrides.
 */
export function detectLeadImportMappings(
  headers: string[],
  rows: Record<string, string>[] = [],
  overrides?: Record<string, string>,
): LeadImportMappingResult {
  const headerMappings = detectColumnMappings(headers).map((m) => ({
    ...m,
    reason: m.reason ?? (m.confidence >= 1.0 ? 'header-exact' : 'header-alias'),
  }));

  const enriched = rows.length > 0 ? enrichHeaderMappings(headerMappings, rows) : headerMappings;
  const inferred = rows.length > 0 ? inferUnmappedColumns(headers, enriched, rows) : [];

  let allMappings = [...enriched, ...inferred];
  allMappings = applyOverrides(allMappings, overrides);

  const mappedColumns = new Set(allMappings.map((m) => m.csvColumn));
  const unmappedColumns = headers.filter((h) => !mappedColumns.has(h));

  return { mappings: allMappings, unmappedColumns };
}

export function buildLeadImportMappingsRecord(
  result: LeadImportMappingResult | ColumnMapping[],
): Record<string, string> {
  const mappings = Array.isArray(result) ? result : result.mappings;
  return buildMappingsRecord(mappings);
}

export { LEAD_FIELDS, CUSTOM_FIELD_TARGETS, normalizeHeader, type LeadField };
