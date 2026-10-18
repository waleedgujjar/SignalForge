/// Multi-tier deduplication.
///
/// Runs in strict priority order, strongest evidence first. The ordering matters:
/// an email match is proof of the same contact, whereas a company-name match is
/// only a hint. Tiers are evaluated against both the current batch and the
/// leads already in the workspace, so importing the same file twice, or finding
/// the same business on two sources, converges on ONE lead.
///
/// The guiding bias is *under*-merging. Wrongly splitting a lead costs one
/// duplicate row; wrongly merging two real businesses silently destroys one of
/// them and can send the wrong person the wrong campaign.

import type { NormalizedLead } from './normalization.js';

export type MatchTier =
  | 'EMAIL'
  | 'DOMAIN'
  | 'PHONE'
  | 'SOURCE_ID'
  | 'COMPANY_LOCATION'
  | 'FUZZY_COMPANY';

/// Minimum similarity for the fuzzy tier. High on purpose — 0.92 accepts
/// "abc dental" vs "abc dentals" but rejects "abc dental" vs "abd dental".
const FUZZY_THRESHOLD = 0.92;

/// A company name this short carries too little signal to fuzzy-match safely.
const MIN_FUZZY_LENGTH = 6;

export interface DedupEntry {
  /// Identifier of whatever this entry represents — an existing Lead id, or the
  /// index of an earlier row in the current batch.
  id: string;
  normalizedEmail: string | null;
  normalizedDomain: string | null;
  normalizedPhone: string | null;
  normalizedCompany: string | null;
  city: string | null;
  countryCode: string | null;
  sourceKey: string | null;
}

export interface DedupMatch {
  id: string;
  tier: MatchTier;
  reason: string;
}

export interface DedupIndex {
  byEmail: Map<string, string>;
  byDomain: Map<string, string>;
  byPhone: Map<string, string>;
  bySourceKey: Map<string, string>;
  byCompanyLocation: Map<string, string>;
  byId: Map<string, DedupEntry>;
  entries: DedupEntry[];
}

/// Two records whose domains are both known and different are different
/// businesses, whatever their names say. Name-based tiers must respect this or
/// they will merge, say, two same-named agencies in one city.
function domainsConflict(a: DedupEntry, b: DedupEntry): boolean {
  return Boolean(a.normalizedDomain && b.normalizedDomain && a.normalizedDomain !== b.normalizedDomain);
}

export function sourceKeyOf(source: string | null | undefined, sourceId: string | null | undefined): string | null {
  if (!source || !sourceId) return null;
  return `${source}:${sourceId}`;
}

function companyLocationKey(entry: {
  normalizedCompany: string | null;
  city: string | null;
  countryCode: string | null;
}): string | null {
  if (!entry.normalizedCompany) return null;
  // Location is required for this tier: "Smile Dental" exists in a hundred
  // cities and is only a duplicate when it is the same one.
  if (!entry.city && !entry.countryCode) return null;
  return [entry.normalizedCompany, entry.city?.toLowerCase() ?? '', entry.countryCode ?? ''].join('|');
}

export function createDedupIndex(entries: DedupEntry[] = []): DedupIndex {
  const index: DedupIndex = {
    byEmail: new Map(),
    byDomain: new Map(),
    byPhone: new Map(),
    bySourceKey: new Map(),
    byCompanyLocation: new Map(),
    byId: new Map(),
    entries: [],
  };
  for (const entry of entries) addToIndex(index, entry);
  return index;
}

export function addToIndex(index: DedupIndex, entry: DedupEntry): void {
  // First writer wins so the earliest record stays canonical.
  if (entry.normalizedEmail && !index.byEmail.has(entry.normalizedEmail)) {
    index.byEmail.set(entry.normalizedEmail, entry.id);
  }
  if (entry.normalizedDomain && !index.byDomain.has(entry.normalizedDomain)) {
    index.byDomain.set(entry.normalizedDomain, entry.id);
  }
  if (entry.normalizedPhone && !index.byPhone.has(entry.normalizedPhone)) {
    index.byPhone.set(entry.normalizedPhone, entry.id);
  }
  if (entry.sourceKey && !index.bySourceKey.has(entry.sourceKey)) {
    index.bySourceKey.set(entry.sourceKey, entry.id);
  }
  const clKey = companyLocationKey(entry);
  if (clKey && !index.byCompanyLocation.has(clKey)) {
    index.byCompanyLocation.set(clKey, entry.id);
  }
  index.byId.set(entry.id, entry);
  index.entries.push(entry);
}

export function toDedupEntry(lead: NormalizedLead, id: string, source?: string | null): DedupEntry {
  return {
    id,
    normalizedEmail: lead.normalizedEmail,
    normalizedDomain: lead.normalizedDomain,
    normalizedPhone: lead.normalizedPhone,
    normalizedCompany: lead.normalizedCompany,
    city: lead.city ?? null,
    countryCode: lead.countryCode ?? null,
    sourceKey: sourceKeyOf(source, lead.sourceId),
  };
}

/// Find the strongest match for `candidate`, or null when it is genuinely new.
export function findDuplicate(candidate: DedupEntry, index: DedupIndex): DedupMatch | null {
  // 1 — exact email. Same mailbox is the same person, full stop.
  if (candidate.normalizedEmail) {
    const hit = index.byEmail.get(candidate.normalizedEmail);
    if (hit && hit !== candidate.id) {
      return { id: hit, tier: 'EMAIL', reason: `Same email (${candidate.normalizedEmail})` };
    }
  }

  // 2 — normalized domain. Two records on one company website are the same
  // company, even when the contact person differs.
  if (candidate.normalizedDomain) {
    const hit = index.byDomain.get(candidate.normalizedDomain);
    if (hit && hit !== candidate.id) {
      return { id: hit, tier: 'DOMAIN', reason: `Same website domain (${candidate.normalizedDomain})` };
    }
  }

  // 3 — phone. Strong for local businesses, which frequently have no email.
  if (candidate.normalizedPhone) {
    const hit = index.byPhone.get(candidate.normalizedPhone);
    if (hit && hit !== candidate.id) {
      return { id: hit, tier: 'PHONE', reason: `Same phone number (${candidate.normalizedPhone})` };
    }
  }

  // 4 — same record from the same source, i.e. the job was re-run.
  if (candidate.sourceKey) {
    const hit = index.bySourceKey.get(candidate.sourceKey);
    if (hit && hit !== candidate.id) {
      return { id: hit, tier: 'SOURCE_ID', reason: `Already imported from ${candidate.sourceKey}` };
    }
  }

  // 5 — identical company name in the same place, unless the two records point
  // at different websites, which settles it: they are separate businesses.
  const clKey = companyLocationKey(candidate);
  if (clKey) {
    const hit = index.byCompanyLocation.get(clKey);
    const hitEntry = hit ? index.byId.get(hit) : undefined;
    if (hit && hit !== candidate.id && hitEntry && !domainsConflict(candidate, hitEntry)) {
      return { id: hit, tier: 'COMPANY_LOCATION', reason: `Same company and location (${candidate.normalizedCompany})` };
    }
  }

  // 6 — near-identical company name, but only within the same city/country and
  // only when neither record has a domain. If both have domains and those
  // domains differ, tier 2 already told us they are different businesses.
  if (candidate.normalizedCompany && candidate.normalizedCompany.length >= MIN_FUZZY_LENGTH) {
    for (const entry of index.entries) {
      if (entry.id === candidate.id) continue;
      if (!entry.normalizedCompany || entry.normalizedCompany.length < MIN_FUZZY_LENGTH) continue;
      if (domainsConflict(candidate, entry)) continue;
      if (!sameLocation(candidate, entry)) continue;

      const score = similarity(candidate.normalizedCompany, entry.normalizedCompany);
      if (score >= FUZZY_THRESHOLD) {
        return {
          id: entry.id,
          tier: 'FUZZY_COMPANY',
          reason: `Company name ${(score * 100).toFixed(0)}% similar to "${entry.normalizedCompany}"`,
        };
      }
    }
  }

  return null;
}

function sameLocation(a: DedupEntry, b: DedupEntry): boolean {
  if (a.city && b.city) return a.city.toLowerCase() === b.city.toLowerCase();
  if (a.countryCode && b.countryCode) return a.countryCode === b.countryCode;
  return false;
}

/// Normalized Levenshtein similarity in [0, 1].
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  // Single-row DP: company names are short, and this runs per candidate pair.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export interface DedupOutcome {
  unique: Array<{ lead: NormalizedLead; batchId: string }>;
  duplicates: Array<{ lead: NormalizedLead; batchId: string; match: DedupMatch }>;
}

/// Deduplicate a batch against itself and against pre-existing workspace leads.
export function dedupeBatch(
  leads: NormalizedLead[],
  existing: DedupEntry[],
  source?: string | null,
): DedupOutcome {
  const index = createDedupIndex(existing);
  const outcome: DedupOutcome = { unique: [], duplicates: [] };

  leads.forEach((lead, position) => {
    const batchId = `batch:${position}`;
    const entry = toDedupEntry(lead, batchId, source);
    const match = findDuplicate(entry, index);
    if (match) {
      outcome.duplicates.push({ lead, batchId, match });
      // Deliberately still indexed: a third copy should resolve to the same
      // canonical record rather than being compared only against the original.
      return;
    }
    addToIndex(index, entry);
    outcome.unique.push({ lead, batchId });
  });

  return outcome;
}
