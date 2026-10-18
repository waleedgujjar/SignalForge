import type {
  TechnicalFindings, PerformanceData, SeoFindings, MobileFindings,
  ContentFindings, ConversionData, AISignalsData, ModernityAssessment,
  ScoreBreakdown, OpportunityDetection, Confidence,
} from '../types.js';

interface OpportunityRule {
  service: string;
  check: (ctx: OpportunityContext) => { match: boolean; evidence: string[]; confidence: Confidence };
}

interface OpportunityContext {
  technical: TechnicalFindings;
  performance: PerformanceData;
  seo: SeoFindings;
  mobile: MobileFindings;
  content: ContentFindings;
  conversion: ConversionData;
  aiSignals: AISignalsData;
  modernity: ModernityAssessment;
  scoreBreakdown: ScoreBreakdown;
  websiteScore: number;
}

const RULES: OpportunityRule[] = [
  {
    service: 'Website Redesign',
    check: (ctx) => {
      const evidence: string[] = [];
      if (ctx.modernity.modernityScore < 40) evidence.push(`Low modernity score: ${ctx.modernity.modernityScore}/100`);
      if (ctx.modernity.outdatedSignals.length > 2) evidence.push(`${ctx.modernity.outdatedSignals.length} outdated patterns detected`);
      if (!ctx.mobile.hasViewportMeta) evidence.push('Not mobile-friendly');
      if (ctx.websiteScore < 40) evidence.push(`Overall website score: ${ctx.websiteScore}/100`);
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
  {
    service: 'SEO Optimization',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.seo.hasTitle || !ctx.seo.hasMetaDescription) evidence.push('Missing title or meta description');
      if (!ctx.seo.hasCanonical) evidence.push('No canonical URL');
      if (ctx.seo.imgsMissingAlt > 3) evidence.push(`${ctx.seo.imgsMissingAlt} images missing alt text`);
      if (!ctx.seo.hasStructuredData) evidence.push('No structured data');
      if (ctx.scoreBreakdown.seo < 50) evidence.push(`SEO score: ${ctx.scoreBreakdown.seo}/100`);
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
  {
    service: 'Performance Optimization',
    check: (ctx) => {
      const evidence: string[] = [];
      if (ctx.performance.avgLoadTimeMs > 3000) evidence.push(`Slow load: ${ctx.performance.avgLoadTimeMs}ms`);
      if (ctx.performance.hasRenderBlockingResources) evidence.push('Render-blocking resources');
      if (!ctx.technical.hasCompression) evidence.push('No compression');
      if (!ctx.technical.hasCaching) evidence.push('No caching headers');
      if (ctx.scoreBreakdown.performance < 50) evidence.push(`Performance score: ${ctx.scoreBreakdown.performance}/100`);
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
  {
    service: 'Lead Generation & CRO',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.conversion.hasContactForm && !ctx.conversion.hasLeadForm) evidence.push('No lead capture forms');
      if (ctx.conversion.ctaCount < 3) evidence.push(`Only ${ctx.conversion.ctaCount} CTAs found`);
      if (!ctx.conversion.hasLiveChat && !ctx.conversion.hasChatbot) evidence.push('No live chat');
      if (!ctx.conversion.hasSocialProof && !ctx.conversion.hasTestimonials) evidence.push('No social proof');
      if (ctx.scoreBreakdown.conversion < 50) evidence.push(`Conversion score: ${ctx.scoreBreakdown.conversion}/100`);
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
  {
    service: 'Security Hardening',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.technical.httpsEnabled) evidence.push('No HTTPS');
      if (!ctx.technical.hasSecurityHeaders) evidence.push('Missing security headers');
      const missingHeaders = Object.entries(ctx.technical.securityHeaderDetails).filter(([, v]) => !v).map(([k]) => k);
      if (missingHeaders.length > 3) evidence.push(`${missingHeaders.length} security headers missing`);
      return { match: evidence.length >= 1 && !ctx.technical.httpsEnabled || evidence.length >= 2, evidence, confidence: !ctx.technical.httpsEnabled ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
  {
    service: 'AI/Automation Integration',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.aiSignals.hasChatbot) evidence.push('No chatbot or AI assistant');
      if (!ctx.aiSignals.hasScheduling) evidence.push('No automated scheduling');
      if (!ctx.aiSignals.hasCRMForms) evidence.push('No CRM integration');
      if (!ctx.aiSignals.hasKnowledgeBase) evidence.push('No knowledge base');
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'MEDIUM' as const : 'LOW' as const };
    },
  },
  {
    service: 'Content Strategy',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.content.hasValueProposition) evidence.push('Weak value proposition');
      if (!ctx.content.hasBlog) evidence.push('No blog or content hub');
      if (!ctx.content.hasTrustSignals) evidence.push('No trust signals');
      if (ctx.content.headingStructureScore < 50) evidence.push('Poor heading structure');
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'MEDIUM' as const : 'LOW' as const };
    },
  },
  {
    service: 'Mobile Optimization',
    check: (ctx) => {
      const evidence: string[] = [];
      if (!ctx.mobile.hasViewportMeta) evidence.push('No viewport meta tag');
      if (!ctx.mobile.hasResponsiveSignals) evidence.push('No responsive design');
      if (ctx.mobile.hasFixedWidthElements) evidence.push('Fixed-width elements');
      if (ctx.scoreBreakdown.mobile < 50) evidence.push(`Mobile score: ${ctx.scoreBreakdown.mobile}/100`);
      return { match: evidence.length >= 2, evidence, confidence: evidence.length >= 3 ? 'HIGH' as const : 'MEDIUM' as const };
    },
  },
];

export function detectOpportunities(
  technical: TechnicalFindings,
  performance: PerformanceData,
  seo: SeoFindings,
  mobile: MobileFindings,
  content: ContentFindings,
  conversion: ConversionData,
  aiSignals: AISignalsData,
  modernity: ModernityAssessment,
  scoreBreakdown: ScoreBreakdown,
  websiteScore: number,
): OpportunityDetection[] {
  const ctx: OpportunityContext = { technical, performance, seo, mobile, content, conversion, aiSignals, modernity, scoreBreakdown, websiteScore };
  const opportunities: OpportunityDetection[] = [];

  for (const rule of RULES) {
    const result = rule.check(ctx);
    if (result.match) {
      let priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' = 'MEDIUM';
      if (result.confidence === 'HIGH' && result.evidence.length >= 3) priority = 'VERY_HIGH';
      else if (result.confidence === 'HIGH') priority = 'HIGH';
      else if (result.confidence === 'LOW') priority = 'LOW';

      opportunities.push({
        service: rule.service,
        evidence: result.evidence,
        confidence: result.confidence,
        priority,
      });
    }
  }

  return opportunities
    .sort((a, b) => priorityOrder(b.priority) - priorityOrder(a.priority))
    .slice(0, 3);
}

function priorityOrder(p: string): number {
  switch (p) {
    case 'VERY_HIGH': return 4;
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    default: return 0;
  }
}
