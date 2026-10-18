import type { DiscoverySourceType, EmailDiscoverySource } from '@signalforge/database';

/// Search criteria accepted by every adapter. Adapters ignore what they cannot
/// honour rather than failing — a CSV has no radius, Google Places has no
/// concept of a minimum ICP score — and report what they applied via
/// `LeadSearchResult.appliedFilters`.
export interface LeadSearchParams {
  country?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  postalCode?: string;
  industry?: string;
  category?: string;
  keywords?: string[];
  radiusMeters?: number;
  maxResults: number;
  requireWebsite?: boolean;
  requirePhone?: boolean;
  requireEmail?: boolean;
  minScore?: number;
}

/// A business exactly as a source described it, before any normalization.
/// Every field is optional because sources disagree wildly about what they
/// return; the normalizer is responsible for producing usable values.
export interface RawDiscoveredLead {
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  countryCode?: string | null;
  state?: string | null;
  city?: string | null;
  postalCode?: string | null;
  employeeCount?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  emailSource?: EmailDiscoverySource | null;
  metadata?: Record<string, unknown>;
}

export interface LeadSearchResult {
  leads: RawDiscoveredLead[];
  /// Filters the adapter was actually able to apply, so the UI can be honest
  /// about which criteria were enforced server-side and which were ignored.
  appliedFilters: string[];
  /// Billable upstream calls made, for cost visibility. Zero for free sources.
  requestsUsed: number;
  warnings?: string[];
}

/// Contract every discovery source implements.
///
/// Adapters are deliberately thin: fetch and shape. They never write to the
/// database, never normalize (the shared normalizer does that so every source
/// dedupes against the same canonical values), and never score.
export interface LeadSourceAdapter {
  readonly source: DiscoverySourceType;
  readonly displayName: string;
  /// False when required credentials are absent. The engine skips unconfigured
  /// adapters instead of failing the job.
  isConfigured(): boolean;
  /// True when the source may bill the workspace for a search.
  readonly billable: boolean;
  search(params: LeadSearchParams, context: AdapterContext): Promise<LeadSearchResult>;
}

export interface AdapterContext {
  workspaceId: string;
  jobId: string;
  /// Raw file bytes for file-backed adapters (CSV/XLSX).
  file?: { buffer: Buffer; mimeType: string; filename?: string; columnMappings?: Record<string, string> };
  signal?: AbortSignal;
}

export class AdapterNotConfiguredError extends Error {
  constructor(source: string) {
    super(`Discovery source "${source}" is not configured`);
    this.name = 'AdapterNotConfiguredError';
  }
}

export class AdapterNotAvailableError extends Error {
  constructor(source: string) {
    super(`Discovery source "${source}" is not available in this version`);
    this.name = 'AdapterNotAvailableError';
  }
}

export class DiscoveryJobNotFoundError extends Error {
  constructor(id: string) {
    super(`Discovery job ${id} not found`);
    this.name = 'DiscoveryJobNotFoundError';
  }
}

export class InvalidDiscoveryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDiscoveryRequestError';
  }
}
