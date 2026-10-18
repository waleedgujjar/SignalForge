/// Barrel export for @signalforge/lead-research.

import { loadEnv } from '@signalforge/config';

import { LeadResearchService } from './service.js';

// ─── Singleton ──────────────────────────────────────────────────────────────

export const leadResearchService = new LeadResearchService();

// ─── Feature gate ────────────────────────────────────────────────────────────

export function isLinkedInResearchEnabled(): boolean {
  try {
    return loadEnv().LINKEDIN_RESEARCH_ENABLED;
  } catch {
    return false;
  }
}

// ─── Types (source-agnostic) ─────────────────────────────────────────────────

export type {
  ResearchErrorCode,
  VerificationLabel,
  ResearchProvenanceSource,
  ResearchProvenanceEntry,
  ResearchContext,
  ResearchSuccessOutcome,
  ResearchFailureOutcome,
  ResearchOutcome,
  ProviderAttempt,
  ResearchRecordUpdate,
  UnifiedHistoryItem,
  ManualVerificationInput,
  ResearchSuggestionKey,
  ResearchSuggestion,
  ProviderUsage,
  ResearchStats,
  ProviderHealthStatus,
  ProviderAuthenticationStatus,
  ProviderStatusEntry,
} from './types.js';

export {
  RETRYABLE_ERROR_CODES,
  CHAIN_STOP_ERROR_CODES,
  isRetryableErrorCode,
  isSuccessOutcome,
  LinkedInUrlError,
  ResearchNotFoundError,
  InvalidResearchStateError,
  ResearchDisabledError,
} from './types.js';

// ─── Activity ────────────────────────────────────────────────────────────────

export {
  logResearchActivity,
  listResearchActivity,
  type ResearchActivityOperation,
  type LogResearchActivityInput,
} from './activity.js';

// ─── Sanitize ────────────────────────────────────────────────────────────────

export {
  stripSecrets,
  sanitizeSecrets,
  stripAnsi,
  sanitizeDoctorOutput,
} from './sanitize.js';

// ─── Service (DB layer) ─────────────────────────────────────────────────────

export { LeadResearchService } from './service.js';

// ─── Enrichment ──────────────────────────────────────────────────────────────

export { ensureEnrichmentQueued } from './enrichment.js';

// ─── Suggestions ─────────────────────────────────────────────────────────────

export { buildResearchSuggestions } from './suggestions.js';

// ─── LinkedIn types ──────────────────────────────────────────────────────────

export type {
  LinkedInProviderName,
  LinkedInCompanyData,
  LinkedInPersonData,
  LinkedInSignals,
  LinkedInResearchData,
  ProviderHealth,
  ProviderDescriptor,
} from './linkedin/types.js';

export { PROVIDER_MAX_CONFIDENCE } from './linkedin/types.js';

// ─── LinkedIn URL ────────────────────────────────────────────────────────────

export {
  parseLinkedInUrl,
  normalizeLinkedInUrl,
  assertLinkedInUrl,
  type ParsedLinkedInUrl,
  type ParseLinkedInUrlResult,
  type LinkedInUrlKind,
} from './linkedin/url.js';

// ─── LinkedIn provider interface ─────────────────────────────────────────────

export type {
  LinkedInResearchProvider,
  CompanyResearchInput,
  PersonResearchInput,
} from './linkedin/provider.js';

export { failureOutcome } from './linkedin/provider.js';

// ─── LinkedIn normalize ──────────────────────────────────────────────────────

export {
  normalizeOutcome,
  calculateConfidence,
  minConfidence,
  isEvidenceField,
  stripEmptyFields,
  buildSummary,
  type NormalizeOptions,
} from './linkedin/normalize.js';

// ─── LinkedIn registry ───────────────────────────────────────────────────────

export {
  listProviders,
  selectProviderChain,
  runProviderHealthChecks,
  hasProvider,
  getProvider,
  DEFAULT_PROVIDER_WORKSPACE_ENABLED,
  type ChainEnv,
  type SelectProviderChainOptions,
} from './linkedin/registry.js';

// ─── LinkedIn service ────────────────────────────────────────────────────────

export {
  LinkedInResearchService,
  mapOutcomeToRecordUpdate,
  type ResearchRunInput,
  type LeadHints,
  type ChainRunResult,
} from './linkedin/service.js';

// ─── Web types ──────────────────────────────────────────────────────────────

export type {
  WebProviderName,
  WebCompanyData,
  WebResearchData,
} from './web/types.js';

export { WEB_PROVIDER_MAX_CONFIDENCE } from './web/types.js';

// ─── Web provider interface ─────────────────────────────────────────────────

export type {
  WebResearchProvider,
  WebCompanyResearchInput,
  WebProviderHealth,
} from './web/provider.js';

export { webFailureOutcome } from './web/provider.js';

// ─── Web registry ───────────────────────────────────────────────────────────

export {
  selectWebProviderChain,
  listWebProviders,
  runWebProviderHealthChecks,
  DEFAULT_WEB_PROVIDER_WORKSPACE_ENABLED,
  type WebChainEnv,
} from './web/registry.js';

// ─── Web service ────────────────────────────────────────────────────────────

export {
  WebResearchService,
  mapWebOutcomeToRecordUpdate,
  type WebResearchRunInput,
  type WebLeadHints,
  type WebChainRunResult,
} from './web/service.js';

// ─── Web normalize ──────────────────────────────────────────────────────────

export {
  normalizeWebOutcome,
  calculateWebConfidence,
} from './web/normalize.js';

// ─── Web feature gate ───────────────────────────────────────────────────────

export function isWebResearchEnabled(): boolean {
  try {
    return loadEnv().WEB_RESEARCH_ENABLED;
  } catch {
    return false;
  }
}
