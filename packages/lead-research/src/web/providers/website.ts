/// Primary web research provider: crawls a company website and extracts
/// structured business intelligence using cheerio. Optionally passes text
/// through an AI interpretation layer when enabled.
///
/// Bounded crawl: maxPages from config (default 5), priority paths only,
/// respects robots.txt. All crawled content is UNTRUSTED DATA.

import { crawlWebsite, validateUrl } from '@signalforge/website-scanner';
import type { CrawledPage, AnalysisConfig } from '@signalforge/website-scanner';
import { loadEnv, type Env } from '@signalforge/config';

import type { ResearchContext, ResearchOutcome, ResearchProvenanceEntry } from '../../types.js';
import type { WebResearchProvider, WebCompanyResearchInput, WebProviderHealth } from '../provider.js';
import { webFailureOutcome } from '../provider.js';
import type { WebCompanyData, WebResearchData } from '../types.js';
import {
  extractCompanyName,
  extractDescription,
  extractServices,
  extractLocation,
  extractCertifications,
  extractServiceArea,
  extractYearEstablished,
  detectPagePresence,
  getAllText,
} from '../extract.js';
import { interpretWebContent, type WebInterpretResult } from '../interpret.js';
import { normalizeWebOutcome } from '../normalize.js';

function buildCrawlConfig(env: Env): AnalysisConfig {
  return {
    maxPages: env.WEB_RESEARCH_MAX_PAGES,
    requestTimeoutMs: 8_000,
    maxResponseBytes: 5 * 1024 * 1024,
    maxRedirects: 5,
    interRequestDelayMs: 500,
    priorityPaths: ['/', '/about', '/services', '/products', '/team', '/contact'],
    blockedPaths: ['/login', '/admin', '/cart', '/checkout', '/account', '/logout'],
  };
}

function addProvenance(
  entries: ResearchProvenanceEntry[],
  field: string,
  value: unknown,
  sourceUrl: string | null,
  confidence: number,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (Array.isArray(value) && value.length === 0) return;

  entries.push({
    field,
    value,
    source: 'WEB_PUBLIC' as ResearchProvenanceEntry['source'],
    sourceUrl,
    provider: 'website',
    retrievedAt: new Date().toISOString(),
    confidence,
    verification: 'INFERRED',
  });
}

function mergeAiResults(
  company: WebCompanyData,
  provenance: ResearchProvenanceEntry[],
  aiResult: WebInterpretResult,
  pageUrl: string | null,
): void {
  const AI_CONFIDENCE = 0.4;

  if (aiResult.services && aiResult.services.length > 0) {
    const existing = new Set((company.services ?? []).map((s) => s.toLowerCase()));
    const novel = aiResult.services.filter((s) => !existing.has(s.toLowerCase()));
    if (novel.length > 0) {
      company.services = [...(company.services ?? []), ...novel].slice(0, 20);
      addProvenance(provenance, 'company.services.ai', novel, pageUrl, AI_CONFIDENCE);
    }
  }

  if (aiResult.specializations && aiResult.specializations.length > 0 && (!company.specializations || company.specializations.length === 0)) {
    company.specializations = aiResult.specializations;
    addProvenance(provenance, 'company.specializations', aiResult.specializations, pageUrl, AI_CONFIDENCE);
  }

  if (aiResult.serviceArea && !company.serviceArea) {
    company.serviceArea = aiResult.serviceArea;
    addProvenance(provenance, 'company.serviceArea.ai', aiResult.serviceArea, pageUrl, AI_CONFIDENCE);
  }

  if (aiResult.yearEstablished && !company.yearEstablished) {
    company.yearEstablished = aiResult.yearEstablished;
    addProvenance(provenance, 'company.yearEstablished.ai', aiResult.yearEstablished, pageUrl, AI_CONFIDENCE);
  }

  if (aiResult.certifications && aiResult.certifications.length > 0) {
    const existing = new Set((company.certifications ?? []).map((c) => c.toLowerCase()));
    const novel = aiResult.certifications.filter((c) => !existing.has(c.toLowerCase()));
    if (novel.length > 0) {
      company.certifications = [...(company.certifications ?? []), ...novel].slice(0, 10);
      addProvenance(provenance, 'company.certifications.ai', novel, pageUrl, AI_CONFIDENCE);
    }
  }
}

export const websiteProvider: WebResearchProvider = {
  name: 'website',
  displayName: 'Website Crawler',

  isConfigured(): boolean {
    return true;
  },

  async healthCheck(): Promise<WebProviderHealth> {
    return {
      provider: 'website',
      displayName: 'Website Crawler',
      status: 'READY',
      authentication: 'NOT_REQUIRED',
      checkedAt: new Date().toISOString(),
      details: ['Uses built-in website scanner — no external dependencies'],
    };
  },

  async researchCompany(input: WebCompanyResearchInput, ctx: ResearchContext): Promise<ResearchOutcome> {
    const url = input.url ?? (input.domain ? `https://${input.domain}` : undefined);
    if (!url) {
      return webFailureOutcome('website', 'UNAVAILABLE', 'INVALID_URL', 'No website URL or domain available');
    }

    try {
      await validateUrl(url);
    } catch (validationError) {
      const msg = validationError instanceof Error ? validationError.message : 'validation failed';
      return webFailureOutcome('website', 'FAILED', 'INVALID_URL', `Invalid URL: ${msg}`);
    }

    const env = loadEnv();
    const config = buildCrawlConfig(env);

    let pages: CrawledPage[];
    try {
      const result = await crawlWebsite(url, config);
      pages = result.pages;
    } catch (error) {
      if (ctx.signal?.aborted) {
        return webFailureOutcome('website', 'FAILED', 'TIMEOUT', `Website crawl timed out`, true);
      }
      const msg = error instanceof Error ? error.message : String(error);
      return webFailureOutcome('website', 'FAILED', 'PAGE_UNAVAILABLE', `Failed to crawl website: ${msg}`, true);
    }

    if (pages.length === 0) {
      return webFailureOutcome('website', 'FAILED', 'PAGE_UNAVAILABLE', 'No pages could be retrieved from the website');
    }

    const DET_CONFIDENCE = 0.6;
    const provenance: ResearchProvenanceEntry[] = [];
    const homeUrl = pages[0]?.url ?? url;

    const company: WebCompanyData = {};

    company.name = extractCompanyName(pages);
    addProvenance(provenance, 'company.name', company.name, homeUrl, DET_CONFIDENCE);

    company.description = extractDescription(pages);
    const descPage = pages.find((p) => /\/(about|who-we-are)/i.test(p.url))?.url ?? homeUrl;
    addProvenance(provenance, 'company.description', company.description, descPage, DET_CONFIDENCE);

    company.services = extractServices(pages);
    const svcPage = pages.find((p) => /\/(services|products)/i.test(p.url))?.url ?? homeUrl;
    addProvenance(provenance, 'company.services', company.services.length > 0 ? company.services : undefined, svcPage, DET_CONFIDENCE);

    company.location = extractLocation(pages);
    const contactPage = pages.find((p) => /\/(contact|location)/i.test(p.url))?.url ?? homeUrl;
    addProvenance(provenance, 'company.location', company.location, contactPage, DET_CONFIDENCE);

    const allText = getAllText(pages);

    company.certifications = extractCertifications(allText);
    addProvenance(provenance, 'company.certifications', company.certifications.length > 0 ? company.certifications : undefined, homeUrl, DET_CONFIDENCE);

    company.serviceArea = extractServiceArea(allText);
    addProvenance(provenance, 'company.serviceArea', company.serviceArea, homeUrl, DET_CONFIDENCE);

    company.yearEstablished = extractYearEstablished(allText);
    addProvenance(provenance, 'company.yearEstablished', company.yearEstablished, homeUrl, DET_CONFIDENCE);

    const presence = detectPagePresence(pages);
    company.hasTeamPage = presence.hasTeamPage;
    company.hasTestimonials = presence.hasTestimonials;
    company.hasBlog = presence.hasBlog;
    company.hasContactForm = presence.hasContactForm;

    if (presence.hasTeamPage) addProvenance(provenance, 'company.hasTeamPage', true, homeUrl, DET_CONFIDENCE);
    if (presence.hasTestimonials) addProvenance(provenance, 'company.hasTestimonials', true, homeUrl, DET_CONFIDENCE);
    if (presence.hasContactForm) addProvenance(provenance, 'company.hasContactForm', true, homeUrl, DET_CONFIDENCE);

    // Optional AI interpretation — failure does NOT destroy deterministic results
    if (env.WEB_RESEARCH_AI_INTERPRETATION_ENABLED && env.AI_PROVIDER !== 'mock') {
      try {
        const aiResult = await interpretWebContent(allText, env);
        mergeAiResults(company, provenance, aiResult, homeUrl);
      } catch (aiError) {
        console.error('Web research AI interpretation failed (deterministic results preserved):', aiError);
      }
    }

    const data: WebResearchData = {
      company,
      source: {
        platform: 'web',
        url,
        retrievedAt: new Date().toISOString(),
      },
    };

    const rawData: Record<string, unknown> = {
      pagesCount: pages.length,
      pageUrls: pages.map((p) => p.url),
      textLength: allText.length,
    };

    return normalizeWebOutcome(data, provenance, {
      provider: 'website',
      raw: rawData,
    });
  },
};
