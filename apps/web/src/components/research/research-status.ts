/**
 * Pure helpers for Module 17 — Lead Research.
 *
 * This module must import nothing from '@/' at runtime: apps/web has no vitest config,
 * so the colocated test resolves only relative, type-only imports.
 */
import type { QueryClient } from '@tanstack/react-query';
import type {
  AssessmentLevel,
  OpportunityAssessment,
  ResearchConfidence,
  ResearchDisplayStatus,
  ResearchProvenance,
  ResearchStatus,
  VerificationState,
} from '../../lib/api';

/** Badge variants that exist on `components/ui/badge.tsx`. */
export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export const RESEARCH_STATUSES: readonly ResearchDisplayStatus[] = [
  'NOT_RESEARCHED',
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIAL',
  'MANUAL_REVIEW',
  'UNAVAILABLE',
  'FAILED',
];

export const RESEARCH_STATUS_LABELS: Record<ResearchDisplayStatus, string> = {
  NOT_RESEARCHED: 'Not Researched',
  PENDING: 'Suggested',
  QUEUED: 'Queued',
  IN_PROGRESS: 'Researching',
  COMPLETED: 'Completed',
  PARTIAL: 'Partial',
  MANUAL_REVIEW: 'Manual Review',
  UNAVAILABLE: 'Unavailable',
  FAILED: 'Failed',
};

/** Class-map idiom of components/sending/sending-job-status-badge.tsx. */
export const RESEARCH_STATUS_STYLES: Record<ResearchDisplayStatus, string> = {
  NOT_RESEARCHED: 'bg-muted text-muted-foreground',
  PENDING: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  QUEUED: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  IN_PROGRESS: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PARTIAL: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  MANUAL_REVIEW: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  UNAVAILABLE: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  FAILED: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export const VERIFICATION_LABELS: Record<VerificationState, string> = {
  VERIFIED: 'Verified',
  INFERRED: 'Inferred',
  UNKNOWN: 'Unknown',
};

export const VERIFICATION_VARIANTS: Record<VerificationState, BadgeTone> = {
  VERIFIED: 'success',
  INFERRED: 'warning',
  UNKNOWN: 'outline',
};

export const CONFIDENCE_VARIANTS: Record<ResearchConfidence, BadgeTone> = {
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
  UNKNOWN: 'outline',
};

export const CONFIDENCE_LABELS: Record<ResearchConfidence, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  UNKNOWN: 'Unknown',
};

export const ASSESSMENT_LEVEL_LABELS: Record<AssessmentLevel, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const OPPORTUNITY_ASSESSMENT_ROWS: readonly { key: keyof OpportunityAssessment; label: string }[] = [
  { key: 'icpFit', label: 'ICP fit' },
  { key: 'serviceFit', label: 'Service fit' },
  { key: 'aiReceptionistOpportunity', label: 'AI receptionist opportunity' },
  { key: 'customerResponseOpportunity', label: 'Customer response opportunity' },
  { key: 'appointmentBookingOpportunity', label: 'Appointment booking opportunity' },
  { key: 'websiteOpportunity', label: 'Website opportunity' },
  { key: 'leadQuality', label: 'Lead quality' },
];

export const RESEARCH_TYPE_LABELS: Record<string, string> = {
  COMPANY: 'Company',
  PERSON: 'Person',
  JOB: 'Job',
  OTHER: 'Other',
};

const PROVENANCE_SOURCE_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn',
  LINKEDIN_PUBLIC: 'LinkedIn (public page)',
  AGENT_REACH: 'Agent-Reach',
  LINKEDIN_API: 'LinkedIn API',
  MANUAL: 'Manual (researcher)',
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set<ResearchStatus>(['QUEUED', 'IN_PROGRESS']);

export function isResearchDisplayStatus(value: string): value is ResearchDisplayStatus {
  return Object.prototype.hasOwnProperty.call(RESEARCH_STATUS_LABELS, value);
}

/** Human label for a lifecycle status; unknown values pass through unchanged. */
export function researchStatusLabel(status: string | null | undefined): string {
  if (!status) return RESEARCH_STATUS_LABELS.NOT_RESEARCHED;
  return isResearchDisplayStatus(status) ? RESEARCH_STATUS_LABELS[status] : status;
}

export function researchStatusStyle(status: string | null | undefined): string {
  if (status && isResearchDisplayStatus(status)) return RESEARCH_STATUS_STYLES[status];
  return RESEARCH_STATUS_STYLES.NOT_RESEARCHED;
}

/** True while a worker may still change the record — drives 3 s polling. */
export function isResearchActive(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status);
}

export function isVerificationState(value: unknown): value is VerificationState {
  return value === 'VERIFIED' || value === 'INFERRED' || value === 'UNKNOWN';
}

/** Anything that is not an explicit label is UNKNOWN — never upgrade. */
export function toVerificationState(value: unknown): VerificationState {
  return isVerificationState(value) ? value : 'UNKNOWN';
}

export function isResearchConfidence(value: unknown): value is ResearchConfidence {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW' || value === 'UNKNOWN';
}

/**
 * Formats a provenance confidence as a percentage.
 * Accepts 0..1 ratios (0.824 → "82%") and 0..100 percentages (82 → "82%"); non-finite → "—".
 */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const percent = value <= 1 ? value * 100 : value;
  const clamped = Math.min(100, Math.max(0, percent));
  return `${Math.round(clamped)}%`;
}

function humanizeSegment(segment: string): string {
  const spaced = segment
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** 'company.employeeRange' → 'Company · Employee range'. */
export function humanizeField(field: string): string {
  return field
    .split('.')
    .map(humanizeSegment)
    .filter(Boolean)
    .join(' · ');
}

export function provenanceSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Unknown source';
  return PROVENANCE_SOURCE_LABELS[source] ?? humanizeSegment(source);
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** 'LinkedIn (public page) · public · 2026-09-16' — provider and date omitted when absent. */
export function formatProvenance(entry: Pick<ResearchProvenance, 'source'> & Partial<Pick<ResearchProvenance, 'provider' | 'retrievedAt'>>): string {
  const parts: string[] = [provenanceSourceLabel(entry.source)];
  if (entry.provider) parts.push(entry.provider);
  const date = isoDate(entry.retrievedAt);
  if (date) parts.push(date);
  return parts.join(' · ');
}

export type LinkedInUrlKind = 'PERSON' | 'COMPANY' | 'SCHOOL' | 'JOB';

export interface LinkedInUrlParts {
  kind: LinkedInUrlKind;
  slug: string;
  host: string;
  normalizedUrl: string;
  sourceUrl: string;
}

const SLUG_PATTERN = /^[A-Za-z0-9\-_%.~]{1,200}$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Client-side mirror of the server URL classifier — used only for inline validation and prefills.
 * The API remains the source of truth (it re-validates every URL).
 */
export function splitLinkedInUrl(input: string | null | undefined): LinkedInUrlParts | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 500) return null;

  const withScheme = SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const head = segments[0];
  const second = segments[1];
  if (!head || !second) return null;

  let kind: LinkedInUrlKind;
  let slug: string;
  let pathPrefix: string;
  switch (head.toLowerCase()) {
    case 'in':
    case 'pub':
      kind = 'PERSON';
      slug = second;
      pathPrefix = 'in';
      break;
    case 'company':
    case 'showcase':
      kind = 'COMPANY';
      slug = second;
      pathPrefix = head.toLowerCase();
      break;
    case 'school':
      kind = 'SCHOOL';
      slug = second;
      pathPrefix = 'school';
      break;
    case 'jobs': {
      const jobId = segments[2];
      if (second.toLowerCase() !== 'view' || !jobId) return null;
      kind = 'JOB';
      slug = jobId;
      pathPrefix = 'jobs/view';
      break;
    }
    default:
      return null;
  }

  if (!SLUG_PATTERN.test(slug)) return null;

  return {
    kind,
    slug,
    host,
    normalizedUrl: `https://www.linkedin.com/${pathPrefix}/${slug.toLowerCase()}`,
    sourceUrl: trimmed,
  };
}

export function isLinkedInPersonUrl(input: string | null | undefined): boolean {
  return splitLinkedInUrl(input)?.kind === 'PERSON';
}

/** Company pages, showcase pages and school pages all count as company research targets. */
export function isLinkedInCompanyUrl(input: string | null | undefined): boolean {
  const kind = splitLinkedInUrl(input)?.kind;
  return kind === 'COMPANY' || kind === 'SCHOOL';
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const RESEARCH_QUERY_KEYS = {
  providerStatus: ['research-provider-status'] as const,
  providers: ['research-providers'] as const,
  queue: ['research-queue'] as const,
  stats: ['research-stats'] as const,
  leadResearch: (leadId: string) => ['lead-research', leadId] as const,
  leadHistory: (leadId: string) => ['lead-research-history', leadId] as const,
  leadSuggestions: (leadId: string) => ['research-suggestions', leadId] as const,
  leadWebsiteAnalysis: (leadId: string) => ['lead-website-analysis', leadId] as const,
  lead: (leadId: string) => ['lead', leadId] as const,
  leadEnrichment: (leadId: string) => ['lead-enrichment', leadId] as const,
};

type Invalidator = Pick<QueryClient, 'invalidateQueries'>;

/**
 * start / approve / retry → the lead's research, history and suggestions plus the queue and stats prefixes.
 * Pass `includeLead: true` after manual verification / mark-verified so the lead card and enrichment refresh too.
 */
export function invalidateResearchQueries(
  client: Invalidator,
  leadId?: string | null,
  options: { includeLead?: boolean } = {},
): void {
  client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.queue });
  client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.stats });
  if (!leadId) return;
  client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.leadResearch(leadId) });
  client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.leadHistory(leadId) });
  client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.leadSuggestions(leadId) });
  if (options.includeLead) {
    client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.lead(leadId) });
    client.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.leadEnrichment(leadId) });
  }
}
