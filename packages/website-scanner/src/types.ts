export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingSource = 'DETERMINISTIC' | 'AI' | 'HEURISTIC';

export interface Finding {
  category: string;
  severity: Severity;
  title: string;
  description: string;
  confidence: Confidence;
  source: FindingSource;
}

export interface CrawledPage {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  html: string;
  contentLength: number;
  loadTimeMs: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  domain: string;
  startUrl: string;
  durationMs: number;
  errors: string[];
}

export interface AnalysisConfig {
  maxPages: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  interRequestDelayMs: number;
  priorityPaths: string[];
  blockedPaths: string[];
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  maxPages: 10,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  interRequestDelayMs: 1000,
  priorityPaths: ['/', '/about', '/services', '/products', '/pricing', '/contact', '/solutions', '/features', '/blog'],
  blockedPaths: ['/login', '/admin', '/cart', '/checkout', '/account', '/logout'],
};

export interface TechnicalFindings {
  findings: Finding[];
  httpsEnabled: boolean;
  hasSecurityHeaders: boolean;
  securityHeaderDetails: Record<string, boolean>;
  hasCompression: boolean;
  hasCaching: boolean;
  hasFavicon: boolean;
  brokenLinkCount: number;
}

export interface PerformanceData {
  findings: Finding[];
  avgLoadTimeMs: number;
  totalPageSizeBytes: number;
  resourceCounts: { scripts: number; stylesheets: number; images: number; total: number };
  hasRenderBlockingResources: boolean;
  largeResources: { url: string; sizeEstimate: string; type: string }[];
}

export interface SeoFindings {
  findings: Finding[];
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasCanonical: boolean;
  hasH1: boolean;
  h1Count: number;
  h2Count: number;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasStructuredData: boolean;
  hasSitemap: boolean;
  hasRobotsTxt: boolean;
  imgsMissingAlt: number;
}

export interface MobileFindings {
  findings: Finding[];
  hasViewportMeta: boolean;
  hasResponsiveSignals: boolean;
  hasFixedWidthElements: boolean;
  touchTargetConcerns: number;
}

export interface ContentFindings {
  findings: Finding[];
  hasValueProposition: boolean;
  hasServiceDescriptions: boolean;
  hasTrustSignals: boolean;
  hasBlog: boolean;
  headingStructureScore: number;
}

export interface ConversionData {
  findings: Finding[];
  hasContactForm: boolean;
  hasLeadForm: boolean;
  ctaCount: number;
  hasBookingWidget: boolean;
  hasLiveChat: boolean;
  hasChatbot: boolean;
  hasSocialProof: boolean;
  hasTestimonials: boolean;
}

export interface TechnologyDetection {
  name: string;
  category: string;
  confidence: Confidence;
}

export interface AISignalsData {
  findings: Finding[];
  hasChatbot: boolean;
  hasAIAssistant: boolean;
  hasCRMForms: boolean;
  hasScheduling: boolean;
  hasKnowledgeBase: boolean;
  hasCustomerPortal: boolean;
}

export interface ModernityAssessment {
  findings: Finding[];
  modernityScore: number;
  outdatedSignals: string[];
  modernSignals: string[];
}

export interface ScoreBreakdown {
  technical: number;
  performance: number;
  seo: number;
  mobile: number;
  contentUx: number;
  conversion: number;
}

export interface OpportunityDetection {
  service: string;
  evidence: string[];
  confidence: Confidence;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

export interface AnalysisResult {
  domain: string;
  url: string;
  pagesCrawled: number;
  crawlDurationMs: number;
  websiteScore: number;
  opportunityScore: number;
  opportunityPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  scoreBreakdown: ScoreBreakdown;
  technicalFindings: TechnicalFindings;
  performanceData: PerformanceData;
  seoFindings: SeoFindings;
  mobileFindings: MobileFindings;
  contentFindings: ContentFindings;
  conversionData: ConversionData;
  technologies: TechnologyDetection[];
  aiSignals: AISignalsData;
  modernityAssessment: ModernityAssessment;
  recommendedServices: OpportunityDetection[];
  errors: string[];
}
