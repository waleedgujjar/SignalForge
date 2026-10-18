/// Pure function that builds research suggestions for a lead.
///
/// Each suggestion describes one research action the UI can offer. The function
/// is deterministic: given the same lead info and research rows it always
/// returns the same list, making it straightforward to test without a database.

import type { LeadResearch } from '@signalforge/database';
import type { ResearchSuggestion, ResearchSuggestionKey } from './types.js';

type LeadInfo = {
  linkedinUrl: string | null;
  website: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
};

type ResearchRow = Pick<LeadResearch, 'source' | 'researchType' | 'status' | 'normalizedUrl'>;

interface SuggestionOptions {
  /** Whether LinkedIn research is enabled at the environment level. */
  enabled: boolean;
  /** Whether a website analysis already exists for this lead. */
  hasWebsiteAnalysis: boolean;
  /** Whether web research is enabled at the environment level. */
  webResearchEnabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPersonUrl(url: string | null | undefined): boolean {
  return url != null && /\/in\//.test(url);
}

function isCompanyUrl(url: string | null | undefined): boolean {
  return url != null && (/\/company\//.test(url) || /\/showcase\//.test(url));
}

function hasCompletedResearch(
  research: ResearchRow[],
  source: string,
  researchType: string,
): boolean {
  return research.some(
    (row) =>
      row.source === source &&
      row.researchType === researchType &&
      (row.status === 'COMPLETED' || row.status === 'PARTIAL'),
  );
}

function hasCompanyLinkedInUrl(research: ResearchRow[], lead: LeadInfo): boolean {
  // Either the lead's own URL is a company page, or a previous research row
  // captured a company URL.
  if (isCompanyUrl(lead.linkedinUrl)) return true;
  return research.some(
    (row) =>
      row.source === 'LINKEDIN' &&
      row.researchType === 'COMPANY' &&
      row.normalizedUrl != null,
  );
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildResearchSuggestions(
  lead: LeadInfo,
  research: ResearchRow[],
  options: SuggestionOptions,
): ResearchSuggestion[] {
  const suggestions: ResearchSuggestion[] = [];

  // COMPANY_LINKEDIN
  const hasCompanyUrl = hasCompanyLinkedInUrl(research, lead);
  const companyDone = hasCompletedResearch(research, 'LINKEDIN', 'COMPANY');
  suggestions.push({
    key: 'COMPANY_LINKEDIN' as ResearchSuggestionKey,
    label: 'Research Company on LinkedIn',
    reason: hasCompanyUrl
      ? companyDone
        ? 'Company LinkedIn research is complete'
        : 'A company LinkedIn URL is available for research'
      : 'No company LinkedIn URL found — add one to enable research',
    available: options.enabled && hasCompanyUrl,
    done: companyDone,
  });

  // PERSON_LINKEDIN
  const hasPersonUrl = isPersonUrl(lead.linkedinUrl);
  const personDone = hasCompletedResearch(research, 'LINKEDIN', 'PERSON');
  suggestions.push({
    key: 'PERSON_LINKEDIN' as ResearchSuggestionKey,
    label: 'Research Person on LinkedIn',
    reason: hasPersonUrl
      ? personDone
        ? 'Person LinkedIn research is complete'
        : 'A personal LinkedIn profile URL is available for research'
      : 'No personal LinkedIn URL found — add one to enable research',
    available: options.enabled && hasPersonUrl,
    done: personDone,
  });

  // WEBSITE
  const hasWebsite = Boolean(lead.website || lead.companyDomain);
  suggestions.push({
    key: 'WEBSITE' as ResearchSuggestionKey,
    label: 'Analyze Website',
    reason: hasWebsite
      ? options.hasWebsiteAnalysis
        ? 'Website analysis is complete'
        : 'A website or company domain is available for analysis'
      : 'No website or company domain found — add one to enable analysis',
    available: hasWebsite,
    done: options.hasWebsiteAnalysis,
  });

  // WEB_SEARCH — research company website
  const webEnabled = options.webResearchEnabled ?? false;
  const webCompanyDone = hasCompletedResearch(research, 'WEB', 'COMPANY');
  suggestions.push({
    key: 'WEB_SEARCH' as ResearchSuggestionKey,
    label: 'Research Company Website',
    reason: hasWebsite
      ? webCompanyDone
        ? 'Web research is complete'
        : webEnabled
          ? 'A company website is available for research'
          : 'Web research is disabled'
      : 'No website or company domain found — add one to enable web research',
    available: webEnabled && hasWebsite && !webCompanyDone,
    done: webCompanyDone,
  });

  return suggestions;
}
