import { crawlWebsite } from './crawler/crawler.js';
import { analyzeTechnical } from './analyzers/technical.js';
import { analyzePerformance } from './analyzers/performance.js';
import { analyzeSeo } from './analyzers/seo.js';
import { analyzeMobile } from './analyzers/mobile.js';
import { analyzeContent } from './analyzers/content.js';
import { analyzeConversion } from './analyzers/conversion.js';
import { detectTechnologies } from './analyzers/technology.js';
import { analyzeAISignals } from './analyzers/ai-signals.js';
import { analyzeModernity } from './analyzers/modernity.js';
import { calculateWebsiteScore } from './scoring/website-scorer.js';
import { calculateOpportunityScore } from './scoring/opportunity-scorer.js';
import { detectOpportunities } from './scoring/opportunity-detector.js';
import { validateUrl } from './crawler/url-validator.js';
import type { AnalysisConfig, AnalysisResult } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

export async function analyzeWebsite(
  url: string,
  configOverrides?: Partial<AnalysisConfig>,
): Promise<AnalysisResult> {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };

  await validateUrl(url);

  const crawlResult = await crawlWebsite(url, config);

  const pages = crawlResult.pages;

  const technical = analyzeTechnical(pages);
  const performance = analyzePerformance(pages);
  const seo = analyzeSeo(pages);
  const mobile = analyzeMobile(pages);
  const content = analyzeContent(pages);
  const conversion = analyzeConversion(pages);
  const technologies = detectTechnologies(pages);
  const aiSignals = analyzeAISignals(pages);
  const modernity = analyzeModernity(pages);

  const { websiteScore, scoreBreakdown } = calculateWebsiteScore(
    technical, performance, seo, mobile, content, conversion,
  );

  const { opportunityScore, opportunityPriority } = calculateOpportunityScore(
    websiteScore, scoreBreakdown,
  );

  const recommendedServices = detectOpportunities(
    technical, performance, seo, mobile, content, conversion,
    aiSignals, modernity, scoreBreakdown, websiteScore,
  );

  return {
    domain: crawlResult.domain,
    url: crawlResult.startUrl,
    pagesCrawled: pages.length,
    crawlDurationMs: crawlResult.durationMs,
    websiteScore,
    opportunityScore,
    opportunityPriority,
    scoreBreakdown,
    technicalFindings: technical,
    performanceData: performance,
    seoFindings: seo,
    mobileFindings: mobile,
    contentFindings: content,
    conversionData: conversion,
    technologies,
    aiSignals,
    modernityAssessment: modernity,
    recommendedServices,
    errors: crawlResult.errors,
  };
}
