import type { LeadResearch, ResearchConfidence } from '@signalforge/database';
import type { LinkedInResearchInput } from '@signalforge/ai';
import type { LinkedInResearchData, ResearchProvenanceEntry } from '@signalforge/lead-research';

/// Maps persisted LinkedIn research rows into the evidence block the AI
/// Provider Layer consumes. Nothing here upgrades trust: provider-fetched rows
/// stay INFERRED, only a researcher's verification makes the block VERIFIED,
/// and two missing rows yield null so the prompt sees "not researched".
export type ResearchRow = Pick<
  LeadResearch,
  | 'id'
  | 'researchType'
  | 'structuredData'
  | 'provenance'
  | 'confidence'
  | 'verifiedAt'
  | 'completedAt'
  | 'updatedAt'
  | 'normalizedUrl'
  | 'sourceUrl'
>;

const CONFIDENCE_RANK: Record<ResearchConfidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function structured(row: ResearchRow | null): LinkedInResearchData | null {
  if (!row || row.structuredData === null || typeof row.structuredData !== 'object') return null;
  return row.structuredData as LinkedInResearchData;
}

function provenanceOf(row: ResearchRow | null): ResearchProvenanceEntry[] {
  if (!row || !Array.isArray(row.provenance)) return [];
  return row.provenance as unknown as ResearchProvenanceEntry[];
}

export function pickResearchedTitle(person: ResearchRow | null): string | null {
  const data = structured(person);
  return data?.person?.title ?? null;
}

export function pickEmployeeRange(company: ResearchRow | null): string | null {
  return structured(company)?.company?.employeeRange ?? null;
}

/// Cache-key fragment: a new, re-run or freshly verified row must invalidate
/// the enrichment inputHash so scores and the AI assessment recompute.
export function researchCacheKey(rows: (ResearchRow | null)[]) {
  return rows
    .filter((row): row is ResearchRow => row !== null)
    .map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    }));
}

function lowestConfidence(rows: ResearchRow[]): LinkedInResearchInput['confidence'] {
  const values = rows.map((row) => row.confidence).filter((c): c is ResearchConfidence => c !== null);
  if (values.length === 0) return 'UNKNOWN';
  return values.reduce((lowest, current) => (CONFIDENCE_RANK[current] < CONFIDENCE_RANK[lowest] ? current : lowest));
}

export function toLinkedInResearchInput(
  company: ResearchRow | null,
  person: ResearchRow | null,
): LinkedInResearchInput | null {
  const rows = [company, person].filter((row): row is ResearchRow => row !== null);
  if (rows.length === 0) return null;

  const companyData = structured(company)?.company ?? null;
  const personData = structured(person)?.person ?? null;
  const signals = structured(person)?.signals ?? structured(company)?.signals ?? null;
  const provenance = rows.flatMap(provenanceOf).map((entry) => ({
    field: entry.field,
    value: entry.value,
    sourceUrl: entry.sourceUrl ?? null,
    verification: entry.verification,
    confidence: entry.confidence,
  }));
  const retrievedAt = rows
    .map((row) => row.completedAt)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const sourceUrls = [
    ...new Set(rows.map((row) => row.normalizedUrl ?? row.sourceUrl).filter((url): url is string => !!url)),
  ];

  return {
    company: companyData
      ? {
          name: companyData.name ?? null,
          tagline: companyData.tagline ?? null,
          industry: companyData.industry ?? null,
          location: companyData.location ?? null,
          employeeRange: companyData.employeeRange ?? null,
          website: companyData.website ?? null,
          description: null,
        }
      : null,
    person: personData
      ? {
          fullName: personData.fullName ?? null,
          headline: personData.title ?? null,
          title: personData.title ?? null,
          company: personData.company ?? null,
          location: personData.location ?? null,
        }
      : null,
    signals: signals
      ? {
          decisionMaker: signals.decisionMaker ?? null,
          hiring: signals.hiring ?? null,
          growthSignal: signals.growthSignal ?? null,
          technologySignal: signals.technologySignal ?? null,
        }
      : null,
    confidence: lowestConfidence(rows),
    verification: rows.some((row) => row.verifiedAt) ? 'VERIFIED' : 'INFERRED',
    provenance,
    retrievedAt: retrievedAt?.toISOString() ?? null,
    sourceUrls,
  };
}
