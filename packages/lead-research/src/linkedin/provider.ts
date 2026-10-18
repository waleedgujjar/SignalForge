/// Contract every LinkedIn research provider implements.
///
/// Providers are deliberately thin: given a URL the researcher supplied, read
/// what is visibly present and report it with provenance. They never write to
/// the database (the worker does), never search by name (no URL means no
/// research), and never perform a LinkedIn action — no connection requests,
/// messages, follows or engagement of any kind. A provider that is refused
/// (authwall, rate limit, private profile) reports the refusal; it does not
/// route around it.

import type { ResearchContext, ResearchErrorCode, ResearchFailureOutcome, ResearchOutcome } from '../types.js';
import type { LinkedInProviderName, ProviderHealth } from './types.js';

export interface CompanyResearchInput {
  url?: string;
  companyName?: string;
}

export interface PersonResearchInput {
  url?: string;
  name?: string;
  company?: string;
}

export interface LinkedInResearchProvider {
  readonly name: LinkedInProviderName;
  readonly displayName: string;
  /// False when the flag/config that enables this provider is absent. The
  /// registry skips unconfigured providers instead of failing the job.
  isConfigured(): boolean;
  healthCheck(): Promise<ProviderHealth>;
  researchCompany(input: CompanyResearchInput, ctx: ResearchContext): Promise<ResearchOutcome>;
  researchPerson(input: PersonResearchInput, ctx: ResearchContext): Promise<ResearchOutcome>;
}

/// Small constructor so every provider reports refusals in one shape.
export function failureOutcome(
  provider: LinkedInProviderName,
  status: ResearchFailureOutcome['status'],
  errorCode: ResearchErrorCode,
  errorMessage: string,
  retryable = false,
  raw?: Record<string, unknown>,
): ResearchFailureOutcome {
  return raw ? { status, provider, errorCode, errorMessage, retryable, raw } : { status, provider, errorCode, errorMessage, retryable };
}
