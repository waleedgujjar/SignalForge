/// Source-agnostic research contracts.
///
/// Everything here is independent of LinkedIn: a research record describes
/// one attempt against one external source for one lead, carries field-level
/// provenance (where each value came from and how trustworthy it is) and ends
/// in exactly one lifecycle status. LinkedIn-specific shapes live under
/// `./linkedin/`; a future Facebook/YouTube adapter reuses these types as-is.

import type {
  LeadResearchStatus,
  LeadResearchType,
  ResearchConfidence,
} from '@signalforge/database';

// ─── Error codes ──────────────────────────────────────────────────────────────

/// Every reason a research attempt can stop short of a result. Codes are
/// persisted on `LeadResearch.errorCode` and shown to the researcher, so they
/// are stable strings rather than free text.
export type ResearchErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'PRIVATE_PROFILE'
  | 'PAGE_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'LOGIN_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INCOMPLETE'
  | 'PARSE_FAILED'
  | 'MANUAL_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'WORKSPACE_MISMATCH'
  | 'NOT_FOUND'
  | 'UNKNOWN';

/// Only transient infrastructure failures may be retried by the queue. A
/// provider refusal (authwall, 429/999, private profile) is never retried
/// around — that would be exactly the "bypass" behaviour the module forbids.
export const RETRYABLE_ERROR_CODES: ReadonlySet<ResearchErrorCode> = new Set<ResearchErrorCode>([
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

/// Codes that end the provider chain immediately: a later provider must not
/// be tried against a page the current one was refused for.
export const CHAIN_STOP_ERROR_CODES: ReadonlySet<ResearchErrorCode> = new Set<ResearchErrorCode>([
  'LOGIN_REQUIRED',
  'RATE_LIMITED',
  'PRIVATE_PROFILE',
  'PAGE_UNAVAILABLE',
]);

export function isRetryableErrorCode(code: string | null | undefined): boolean {
  return code != null && RETRYABLE_ERROR_CODES.has(code as ResearchErrorCode);
}

// ─── Provenance ───────────────────────────────────────────────────────────────

/// How trustworthy a single value is. Orthogonal to the record's lifecycle
/// status: a COMPLETED record can be entirely INFERRED until a human marks it.
export type VerificationLabel = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';

export type ResearchProvenanceSource = 'LINKEDIN_PUBLIC' | 'AGENT_REACH' | 'LINKEDIN_API' | 'WEB_PUBLIC' | 'MANUAL';

/// One researched field. Shape aligned with website-scanner's ProvenanceEntry
/// (field / value / sourceUrl / retrievedAt) so the UI can render both with one
/// component; `confidence` is numeric 0..1 here and rolled up to the API's
/// HIGH/MEDIUM/LOW/UNKNOWN enum at the record level.
export interface ResearchProvenanceEntry {
  field: string;
  value: unknown;
  source: ResearchProvenanceSource;
  sourceUrl: string | null;
  provider: string;
  retrievedAt: string;
  confidence: number;
  verification: VerificationLabel;
}

// ─── Provider execution ───────────────────────────────────────────────────────

/// Passed to every provider call. `chainNotes` accumulates human-readable
/// reasons from providers that stepped aside (e.g. "Agent-Reach MCP disabled")
/// so the terminal manual provider can explain why a researcher is needed.
export interface ResearchContext {
  workspaceId: string;
  leadId: string;
  researchId: string;
  timeoutMs: number;
  signal?: AbortSignal;
  chainNotes: string[];
}

export interface ResearchSuccessOutcome {
  status: 'COMPLETED' | 'PARTIAL';
  provider: string;
  data: Record<string, unknown>;
  provenance: ResearchProvenanceEntry[];
  confidence: ResearchConfidence;
  summary: string;
  raw?: Record<string, unknown>;
}

export interface ResearchFailureOutcome {
  status: 'MANUAL_REVIEW' | 'UNAVAILABLE' | 'FAILED';
  provider: string;
  errorCode: ResearchErrorCode;
  errorMessage: string;
  retryable: boolean;
  raw?: Record<string, unknown>;
}

export type ResearchOutcome = ResearchSuccessOutcome | ResearchFailureOutcome;

export function isSuccessOutcome(outcome: ResearchOutcome): outcome is ResearchSuccessOutcome {
  return outcome.status === 'COMPLETED' || outcome.status === 'PARTIAL';
}

/// One provider's turn in the chain, kept on the record for audit.
export interface ProviderAttempt {
  provider: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: ResearchOutcome['status'];
  errorCode: ResearchErrorCode | null;
  errorMessage: string | null;
}

/// What the worker persists onto `LeadResearch` once the chain has ended.
export interface ResearchRecordUpdate {
  status: Extract<LeadResearchStatus, 'COMPLETED' | 'PARTIAL' | 'MANUAL_REVIEW' | 'FAILED' | 'UNAVAILABLE'>;
  provider: string | null;
  confidence: ResearchConfidence | null;
  summary: string | null;
  structuredData: Record<string, unknown> | null;
  provenance: ResearchProvenanceEntry[] | null;
  rawData: Record<string, unknown> | null;
  errorCode: ResearchErrorCode | null;
  errorMessage: string | null;
  attempts: ProviderAttempt[];
  retryable: boolean;
}

// ─── Read models ──────────────────────────────────────────────────────────────

/// One row of the unified Research History, composed at read time from
/// LeadResearch, WebsiteAnalysis and EmailVerificationHistory (no dual writes).
export interface UnifiedHistoryItem {
  id: string;
  /// ISO timestamp.
  date: string;
  source: 'LINKEDIN' | 'WEB' | 'WEBSITE' | 'EMAIL_VERIFICATION';
  type: string;
  status: string;
  provider: string | null;
  confidence: string | number | null;
  sourceUrl: string | null;
  href: string;
}

export interface ManualVerificationInput {
  person?: {
    firstName?: string;
    lastName?: string;
    title?: string;
    profileUrl?: string;
  };
  company?: {
    name?: string;
    url?: string;
    industry?: string;
    location?: string;
    employeeRange?: string;
  };
  signals?: {
    decisionMaker?: boolean;
    hiring?: boolean;
    growthSignal?: boolean;
    technologySignal?: boolean;
  };
  notes?: string;
}

export type ResearchSuggestionKey = 'COMPANY_LINKEDIN' | 'PERSON_LINKEDIN' | 'WEBSITE' | 'WEB_SEARCH';

export interface ResearchSuggestion {
  key: ResearchSuggestionKey;
  label: string;
  reason: string;
  /// A real action exists for this suggestion right now.
  available: boolean;
  /// The research already happened; the UI renders it as done, not actionable.
  done: boolean;
}

export interface ProviderUsage {
  requestCount: number;
  successfulRequests: number;
  failedRequests: number;
  manualReviewCount: number;
  lastUsedAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
}

export interface ResearchStats {
  total: number;
  byStatus: Record<LeadResearchStatus, number>;
  byType: Record<LeadResearchType, number>;
  manualReviewCount: number;
  pendingCount: number;
  verifiedCount: number;
  completedLast7Days: number;
  providers: Array<ProviderUsage & { provider: string; source: string; enabled: boolean }>;
}

export type ProviderHealthStatus = 'READY' | 'NEEDS_SETUP' | 'UNAVAILABLE' | 'DISABLED';
export type ProviderAuthenticationStatus = 'CONFIGURED' | 'NOT_CONFIGURED' | 'NOT_REQUIRED';

/// What `GET /lead-research/providers/status` returns per provider: the last
/// persisted health merged with workspace enablement and usage counters.
/// Whitelisted fields only — never env values or provider output.
export interface ProviderStatusEntry {
  provider: string;
  displayName: string;
  status: ProviderHealthStatus;
  authentication: ProviderAuthenticationStatus;
  checkedAt: string;
  details: string[];
  implemented: boolean;
  note?: string;
  enabled: boolean;
  usage: ProviderUsage | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class LinkedInUrlError extends Error {
  readonly code: 'INVALID_URL' | 'UNSUPPORTED_URL';

  constructor(code: 'INVALID_URL' | 'UNSUPPORTED_URL', message: string) {
    super(message);
    this.name = 'LinkedInUrlError';
    this.code = code;
  }
}

export class ResearchNotFoundError extends Error {
  constructor(id: string, entity = 'Research record') {
    super(`${entity} ${id} not found`);
    this.name = 'ResearchNotFoundError';
  }
}

export class InvalidResearchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchStateError';
  }
}

export class ResearchDisabledError extends Error {
  constructor() {
    super('LinkedIn research is disabled (LINKEDIN_RESEARCH_ENABLED=false)');
    this.name = 'ResearchDisabledError';
  }
}
