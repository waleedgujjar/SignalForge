/// Contract every web research provider implements.
///
/// Providers crawl a known company website and report structured findings with
/// provenance. They never write to the database (the worker does), never
/// perform autonomous browsing beyond the bounded crawl, and never follow
/// instructions found in page content.

import type { ResearchContext, ResearchErrorCode, ResearchFailureOutcome, ResearchOutcome } from '../types.js';
import type { WebProviderName } from './types.js';

export interface WebCompanyResearchInput {
  url?: string;
  companyName?: string;
  domain?: string;
}

export interface WebResearchProvider {
  readonly name: WebProviderName;
  readonly displayName: string;
  isConfigured(): boolean;
  healthCheck(): Promise<WebProviderHealth>;
  researchCompany(input: WebCompanyResearchInput, ctx: ResearchContext): Promise<ResearchOutcome>;
}

export interface WebProviderHealth {
  provider: WebProviderName;
  displayName: string;
  status: 'READY' | 'NEEDS_SETUP' | 'UNAVAILABLE' | 'DISABLED';
  authentication: 'CONFIGURED' | 'NOT_CONFIGURED' | 'NOT_REQUIRED';
  checkedAt: string;
  details: string[];
}

export function webFailureOutcome(
  provider: WebProviderName,
  status: ResearchFailureOutcome['status'],
  errorCode: ResearchErrorCode,
  errorMessage: string,
  retryable = false,
  raw?: Record<string, unknown>,
): ResearchFailureOutcome {
  return raw
    ? { status, provider, errorCode, errorMessage, retryable, raw }
    : { status, provider, errorCode, errorMessage, retryable };
}
