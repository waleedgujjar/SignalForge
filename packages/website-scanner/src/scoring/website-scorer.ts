import type { TechnicalFindings, PerformanceData, SeoFindings, MobileFindings, ContentFindings, ConversionData, ScoreBreakdown } from '../types.js';

const WEIGHTS = {
  technical: 0.20,
  performance: 0.15,
  seo: 0.20,
  mobile: 0.15,
  contentUx: 0.15,
  conversion: 0.15,
};

export function calculateWebsiteScore(
  technical: TechnicalFindings,
  performance: PerformanceData,
  seo: SeoFindings,
  mobile: MobileFindings,
  content: ContentFindings,
  conversion: ConversionData,
): { websiteScore: number; scoreBreakdown: ScoreBreakdown } {
  const technicalScore = scoreTechnical(technical);
  const performanceScore = scorePerformance(performance);
  const seoScore = scoreSeo(seo);
  const mobileScore = scoreMobile(mobile);
  const contentUxScore = scoreContent(content);
  const conversionScore = scoreConversion(conversion);

  const websiteScore = Math.round(
    technicalScore * WEIGHTS.technical +
    performanceScore * WEIGHTS.performance +
    seoScore * WEIGHTS.seo +
    mobileScore * WEIGHTS.mobile +
    contentUxScore * WEIGHTS.contentUx +
    conversionScore * WEIGHTS.conversion,
  );

  return {
    websiteScore: Math.max(0, Math.min(100, websiteScore)),
    scoreBreakdown: {
      technical: technicalScore,
      performance: performanceScore,
      seo: seoScore,
      mobile: mobileScore,
      contentUx: contentUxScore,
      conversion: conversionScore,
    },
  };
}

function scoreTechnical(t: TechnicalFindings): number {
  let score = 0;
  if (t.httpsEnabled) score += 30;
  if (t.hasSecurityHeaders) score += 25;
  if (t.hasCompression) score += 15;
  if (t.hasCaching) score += 15;
  if (t.hasFavicon) score += 5;
  if (t.brokenLinkCount === 0) score += 10;
  return Math.min(100, score);
}

function scorePerformance(p: PerformanceData): number {
  let score = 50;
  if (p.avgLoadTimeMs < 1000) score += 30;
  else if (p.avgLoadTimeMs < 2000) score += 20;
  else if (p.avgLoadTimeMs < 3000) score += 10;
  else score -= 10;

  if (!p.hasRenderBlockingResources) score += 10;
  if (p.resourceCounts.total < 20) score += 10;
  else if (p.resourceCounts.total < 40) score += 5;
  else score -= 5;

  return Math.max(0, Math.min(100, score));
}

function scoreSeo(s: SeoFindings): number {
  let score = 0;
  if (s.hasTitle) score += 15;
  if (s.hasMetaDescription) score += 15;
  if (s.hasCanonical) score += 10;
  if (s.hasH1) score += 10;
  if (s.hasOpenGraph) score += 10;
  if (s.hasTwitterCard) score += 5;
  if (s.hasStructuredData) score += 10;
  if (s.imgsMissingAlt === 0) score += 10;
  else if (s.imgsMissingAlt < 5) score += 5;
  if (s.h2Count >= 2) score += 10;
  if (s.hasSitemap) score += 5;
  return Math.min(100, score);
}

function scoreMobile(m: MobileFindings): number {
  let score = 0;
  if (m.hasViewportMeta) score += 40;
  if (m.hasResponsiveSignals) score += 30;
  if (!m.hasFixedWidthElements) score += 20;
  if (m.touchTargetConcerns === 0) score += 10;
  return Math.min(100, score);
}

function scoreContent(c: ContentFindings): number {
  let score = 0;
  if (c.hasValueProposition) score += 25;
  if (c.hasServiceDescriptions) score += 20;
  if (c.hasTrustSignals) score += 20;
  if (c.hasBlog) score += 10;
  score += Math.round(c.headingStructureScore * 0.25);
  return Math.min(100, score);
}

function scoreConversion(c: ConversionData): number {
  let score = 0;
  if (c.hasContactForm || c.hasLeadForm) score += 25;
  if (c.ctaCount >= 3) score += 20;
  else if (c.ctaCount >= 1) score += 10;
  if (c.hasBookingWidget) score += 15;
  if (c.hasLiveChat || c.hasChatbot) score += 15;
  if (c.hasSocialProof) score += 10;
  if (c.hasTestimonials) score += 15;
  return Math.min(100, score);
}
