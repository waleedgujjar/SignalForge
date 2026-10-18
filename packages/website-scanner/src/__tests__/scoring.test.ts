import { describe, it, expect } from 'vitest';
import { calculateWebsiteScore } from '../scoring/website-scorer.js';
import { calculateOpportunityScore } from '../scoring/opportunity-scorer.js';
import { detectOpportunities } from '../scoring/opportunity-detector.js';
import type {
  TechnicalFindings, PerformanceData, SeoFindings,
  MobileFindings, ContentFindings, ConversionData,
  AISignalsData, ModernityAssessment, ScoreBreakdown,
} from '../types.js';

function makeGoodTechnical(): TechnicalFindings {
  return {
    findings: [],
    httpsEnabled: true,
    hasSecurityHeaders: true,
    securityHeaderDetails: { hsts: true, xcto: true, xfo: true, csp: true, referrer: true, permissions: true },
    hasCompression: true,
    hasCaching: true,
    hasFavicon: true,
    brokenLinkCount: 0,
  };
}

function makeBadTechnical(): TechnicalFindings {
  return {
    findings: [],
    httpsEnabled: false,
    hasSecurityHeaders: false,
    securityHeaderDetails: { hsts: false, xcto: false, xfo: false, csp: false, referrer: false, permissions: false },
    hasCompression: false,
    hasCaching: false,
    hasFavicon: false,
    brokenLinkCount: 5,
  };
}

function makeGoodPerformance(): PerformanceData {
  return {
    findings: [],
    avgLoadTimeMs: 500,
    totalPageSizeBytes: 500_000,
    resourceCounts: { scripts: 3, stylesheets: 2, images: 5, total: 10 },
    hasRenderBlockingResources: false,
    largeResources: [],
  };
}

function makeBadPerformance(): PerformanceData {
  return {
    findings: [],
    avgLoadTimeMs: 5000,
    totalPageSizeBytes: 5_000_000,
    resourceCounts: { scripts: 20, stylesheets: 10, images: 30, total: 60 },
    hasRenderBlockingResources: true,
    largeResources: [],
  };
}

function makeGoodSeo(): SeoFindings {
  return {
    findings: [],
    hasTitle: true,
    hasMetaDescription: true,
    hasCanonical: true,
    hasH1: true,
    h1Count: 1,
    h2Count: 4,
    hasOpenGraph: true,
    hasTwitterCard: true,
    hasStructuredData: true,
    hasSitemap: true,
    hasRobotsTxt: true,
    imgsMissingAlt: 0,
  };
}

function makeBadSeo(): SeoFindings {
  return {
    findings: [],
    hasTitle: false,
    hasMetaDescription: false,
    hasCanonical: false,
    hasH1: false,
    h1Count: 0,
    h2Count: 0,
    hasOpenGraph: false,
    hasTwitterCard: false,
    hasStructuredData: false,
    hasSitemap: false,
    hasRobotsTxt: false,
    imgsMissingAlt: 10,
  };
}

function makeGoodMobile(): MobileFindings {
  return { findings: [], hasViewportMeta: true, hasResponsiveSignals: true, hasFixedWidthElements: false, touchTargetConcerns: 0 };
}

function makeBadMobile(): MobileFindings {
  return { findings: [], hasViewportMeta: false, hasResponsiveSignals: false, hasFixedWidthElements: true, touchTargetConcerns: 5 };
}

function makeGoodContent(): ContentFindings {
  return { findings: [], hasValueProposition: true, hasServiceDescriptions: true, hasTrustSignals: true, hasBlog: true, headingStructureScore: 80 };
}

function makeBadContent(): ContentFindings {
  return { findings: [], hasValueProposition: false, hasServiceDescriptions: false, hasTrustSignals: false, hasBlog: false, headingStructureScore: 10 };
}

function makeGoodConversion(): ConversionData {
  return { findings: [], hasContactForm: true, hasLeadForm: true, ctaCount: 5, hasBookingWidget: true, hasLiveChat: true, hasChatbot: true, hasSocialProof: true, hasTestimonials: true };
}

function makeBadConversion(): ConversionData {
  return { findings: [], hasContactForm: false, hasLeadForm: false, ctaCount: 0, hasBookingWidget: false, hasLiveChat: false, hasChatbot: false, hasSocialProof: false, hasTestimonials: false };
}

function makeGoodAISignals(): AISignalsData {
  return { findings: [], hasChatbot: true, hasAIAssistant: true, hasCRMForms: true, hasScheduling: true, hasKnowledgeBase: true, hasCustomerPortal: true };
}

function makeBadAISignals(): AISignalsData {
  return { findings: [], hasChatbot: false, hasAIAssistant: false, hasCRMForms: false, hasScheduling: false, hasKnowledgeBase: false, hasCustomerPortal: false };
}

function makeGoodModernity(): ModernityAssessment {
  return { findings: [], modernityScore: 90, outdatedSignals: [], modernSignals: ['HTML5 semantic elements', 'Modern CSS layout', 'Lazy loading'] };
}

function makeBadModernity(): ModernityAssessment {
  return { findings: [], modernityScore: 20, outdatedSignals: ['Deprecated <font> tag', 'Tables for layout', 'Inline styles', 'Flash'], modernSignals: [] };
}

describe('calculateWebsiteScore', () => {
  it('returns high score for a well-built site', () => {
    const { websiteScore, scoreBreakdown } = calculateWebsiteScore(
      makeGoodTechnical(), makeGoodPerformance(), makeGoodSeo(),
      makeGoodMobile(), makeGoodContent(), makeGoodConversion(),
    );
    expect(websiteScore).toBeGreaterThanOrEqual(80);
    expect(scoreBreakdown.technical).toBeGreaterThanOrEqual(80);
    expect(scoreBreakdown.seo).toBeGreaterThanOrEqual(80);
  });

  it('returns low score for a poorly-built site', () => {
    const { websiteScore, scoreBreakdown } = calculateWebsiteScore(
      makeBadTechnical(), makeBadPerformance(), makeBadSeo(),
      makeBadMobile(), makeBadContent(), makeBadConversion(),
    );
    expect(websiteScore).toBeLessThanOrEqual(30);
    expect(scoreBreakdown.technical).toBe(0);
    expect(scoreBreakdown.seo).toBe(0);
  });

  it('clamps score to 0-100', () => {
    const { websiteScore } = calculateWebsiteScore(
      makeGoodTechnical(), makeGoodPerformance(), makeGoodSeo(),
      makeGoodMobile(), makeGoodContent(), makeGoodConversion(),
    );
    expect(websiteScore).toBeGreaterThanOrEqual(0);
    expect(websiteScore).toBeLessThanOrEqual(100);
  });
});

describe('calculateOpportunityScore', () => {
  it('high opportunity for bad website', () => {
    const breakdown: ScoreBreakdown = { technical: 10, performance: 20, seo: 15, mobile: 10, contentUx: 5, conversion: 10 };
    const { opportunityScore, opportunityPriority } = calculateOpportunityScore(12, breakdown);
    expect(opportunityScore).toBeGreaterThanOrEqual(75);
    expect(opportunityPriority).toBe('VERY_HIGH');
  });

  it('low opportunity for good website', () => {
    const breakdown: ScoreBreakdown = { technical: 90, performance: 85, seo: 95, mobile: 90, contentUx: 80, conversion: 85 };
    const { opportunityScore, opportunityPriority } = calculateOpportunityScore(88, breakdown);
    expect(opportunityScore).toBeLessThanOrEqual(35);
    expect(opportunityPriority).toBe('LOW');
  });

  it('inverse relationship: lower website score = higher opportunity', () => {
    const goodBreakdown: ScoreBreakdown = { technical: 90, performance: 85, seo: 95, mobile: 90, contentUx: 80, conversion: 85 };
    const badBreakdown: ScoreBreakdown = { technical: 20, performance: 20, seo: 20, mobile: 20, contentUx: 20, conversion: 20 };
    const good = calculateOpportunityScore(88, goodBreakdown);
    const bad = calculateOpportunityScore(20, badBreakdown);
    expect(bad.opportunityScore).toBeGreaterThan(good.opportunityScore);
  });

  it('maps priorities correctly', () => {
    const b: ScoreBreakdown = { technical: 50, performance: 50, seo: 50, mobile: 50, contentUx: 50, conversion: 50 };
    const r1 = calculateOpportunityScore(5, b);
    expect(r1.opportunityPriority).toBe('VERY_HIGH');

    const r2 = calculateOpportunityScore(30, b);
    expect(r2.opportunityPriority).toBe('HIGH');

    const r3 = calculateOpportunityScore(55, b);
    expect(r3.opportunityPriority).toBe('MEDIUM');

    const r4 = calculateOpportunityScore(90, b);
    expect(r4.opportunityPriority).toBe('LOW');
  });
});

describe('detectOpportunities', () => {
  it('detects multiple opportunities for a bad site', () => {
    const result = detectOpportunities(
      makeBadTechnical(), makeBadPerformance(), makeBadSeo(),
      makeBadMobile(), makeBadContent(), makeBadConversion(),
      makeBadAISignals(), makeBadModernity(),
      { technical: 0, performance: 35, seo: 0, mobile: 0, contentUx: 3, conversion: 0 },
      10,
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns at most 3 opportunities', () => {
    const result = detectOpportunities(
      makeBadTechnical(), makeBadPerformance(), makeBadSeo(),
      makeBadMobile(), makeBadContent(), makeBadConversion(),
      makeBadAISignals(), makeBadModernity(),
      { technical: 0, performance: 0, seo: 0, mobile: 0, contentUx: 0, conversion: 0 },
      5,
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns fewer for a good site', () => {
    const result = detectOpportunities(
      makeGoodTechnical(), makeGoodPerformance(), makeGoodSeo(),
      makeGoodMobile(), makeGoodContent(), makeGoodConversion(),
      makeGoodAISignals(), makeGoodModernity(),
      { technical: 100, performance: 90, seo: 100, mobile: 100, contentUx: 95, conversion: 100 },
      95,
    );
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('sorts by priority descending', () => {
    const result = detectOpportunities(
      makeBadTechnical(), makeBadPerformance(), makeBadSeo(),
      makeBadMobile(), makeBadContent(), makeBadConversion(),
      makeBadAISignals(), makeBadModernity(),
      { technical: 0, performance: 35, seo: 0, mobile: 0, contentUx: 3, conversion: 0 },
      10,
    );
    if (result.length >= 2) {
      const order = { VERY_HIGH: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      for (let i = 0; i < result.length - 1; i++) {
        expect(order[result[i]!.priority]).toBeGreaterThanOrEqual(order[result[i + 1]!.priority]);
      }
    }
  });

  it('each opportunity has evidence', () => {
    const result = detectOpportunities(
      makeBadTechnical(), makeBadPerformance(), makeBadSeo(),
      makeBadMobile(), makeBadContent(), makeBadConversion(),
      makeBadAISignals(), makeBadModernity(),
      { technical: 0, performance: 0, seo: 0, mobile: 0, contentUx: 0, conversion: 0 },
      5,
    );
    for (const opp of result) {
      expect(opp.evidence.length).toBeGreaterThan(0);
      expect(opp.service).toBeTruthy();
    }
  });
});
