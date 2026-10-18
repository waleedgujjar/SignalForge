export interface LeadScoreResult {
  score: number;
  reasons: string[];
  category: 'HOT' | 'WARM' | 'COLD' | 'UNQUALIFIED';
}

export interface CompanyResearchResult {
  summary: string;
  signals: string[];
  industryFit: number;
}

export interface EmailPersonalizationResult {
  subject: string;
  body: string;
}

export interface ReplyClassificationResult {
  category:
    | 'INTERESTED'
    | 'NOT_INTERESTED'
    | 'QUESTION'
    | 'NEEDS_FOLLOW_UP'
    | 'OOO'
    | 'UNSUBSCRIBE'
    | 'WRONG_PERSON'
    | 'REFERRAL'
    | 'POSITIVE'
    | 'NEGATIVE'
    | 'NEUTRAL'
    | 'UNKNOWN';
  confidence: number;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  summary?: string;
  suggestedAction?: string;
}

export interface ReplySuggestionResult {
  draft: string;
  tone: 'professional' | 'friendly' | 'concise';
}

/**
 * Deterministic metrics handed to the model for summarization.
 *
 * The analysis is advisory only: the caller passes already-computed numbers and
 * discards anything in the response that is not narrative text, so the model can
 * never influence suppression, protection, or send eligibility.
 */
export interface DeliverabilityAnalysisInput {
  mailboxLabel: string;
  healthScore: number;
  tier: string;
  protectionLevel: string;
  metrics: {
    attempted: number;
    sent: number;
    delivered: number;
    bounced: number;
    hardBounces: number;
    softBounces: number;
    failed: number;
    uniqueReplies: number;
    unsubscribes: number;
  };
  rates: {
    bounceRate: number;
    failureRate: number;
    replyRate: number;
    unsubscribeRate: number;
  };
  authentication: {
    spf: string;
    dkim: string;
    dmarc: string;
    mx: string;
  } | null;
  complaintDataAvailable: boolean;
}

export interface DeliverabilityAnalysisResult {
  summary: string;
  riskScore: number;
  investigationAreas: string[];
  recommendations: string[];
}

/**
 * Pre-computed analytics KPIs handed to the model for narration.
 *
 * Same boundary as `DeliverabilityAnalysisInput`: only numbers the system has
 * already measured are sent, and only prose comes back. The model is never
 * asked to estimate a metric the product cannot track — notably open rates and
 * revenue, which do not exist here at all.
 */
export interface AnalyticsAnalysisInput {
  periodLabel: string;
  leads: {
    imported: number;
    verified: number;
    qualified: number;
    contacted: number;
    replied: number;
    positiveReplies: number;
    meetings: number;
  };
  email: {
    sent: number;
    delivered: number;
    bounced: number;
    failed: number;
    replies: number;
    unsubscribes: number;
  };
  rates: {
    deliveryRate: number;
    bounceRate: number;
    replyRate: number;
    unsubscribeRate: number;
  };
  trends: Array<{ metric: string; current: number; previous: number }>;
  topCampaigns: Array<{ name: string; sent: number; replyRate: number }>;
  /// Metrics the product cannot measure, so the model does not invent them.
  unavailableMetrics: string[];
}

export interface AnalyticsAnalysisResult {
  summary: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
}

export interface WebsiteAIAnalysisInput {
  domain: string;
  websiteScore: number;
  categoryScores: { technical: number; performance: number; seo: number; mobile: number; contentUx: number; conversion: number };
  keyIssues: string[];
  technologies: string[];
  conversionGaps: string[];
  modernityScore: number;
  companyDescription?: string;
  industry?: string;
  services?: string[];
}

export interface WebsiteAIAnalysisResult {
  summary: string;
  keyIssues: string[];
  opportunities: { service: string; evidence: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  personalizationHooks: string[];
}

/**
 * How trustworthy a researched value is (Module 17 — Lead Research).
 *
 * VERIFIED = confirmed by a human researcher, INFERRED = parsed from a public
 * page, UNKNOWN = not established. Labels only ever move towards VERIFIED via a
 * human action; the model must never upgrade one.
 */
export type ResearchVerificationLabel = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';

/**
 * LinkedIn research handed to `enrichLead` as additional evidence.
 *
 * Every inner field is optional and nullable: only values a researcher or a
 * public page actually established are set. Nothing here is ever fabricated,
 * and a missing field means "not established", never "false".
 */
export interface LinkedInResearchInput {
  company?: {
    name?: string | null;
    tagline?: string | null;
    industry?: string | null;
    location?: string | null;
    employeeRange?: string | null;
    website?: string | null;
    description?: string | null;
  } | null;
  person?: {
    fullName?: string | null;
    headline?: string | null;
    title?: string | null;
    company?: string | null;
    location?: string | null;
  } | null;
  signals?: {
    decisionMaker?: boolean | null;
    hiring?: boolean | null;
    growthSignal?: boolean | null;
    technologySignal?: boolean | null;
  } | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  verification: ResearchVerificationLabel;
  provenance: {
    field: string;
    value: unknown;
    sourceUrl: string | null;
    verification: ResearchVerificationLabel;
    confidence: number;
  }[];
  retrievedAt: string | null;
  sourceUrls: string[];
}

export type OpportunityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * One row of the opportunity assessment. `value: null` + `status: 'UNKNOWN'`
 * + `evidence: []` is the required answer whenever no supporting data exists —
 * the absence of evidence is never reported as a finding.
 */
export interface OpportunityAssessmentEntry {
  value: OpportunityLevel | null;
  status: ResearchVerificationLabel;
  evidence: string[];
}

export interface OpportunityAssessment {
  icpFit: OpportunityAssessmentEntry;
  serviceFit: OpportunityAssessmentEntry;
  aiReceptionistOpportunity: OpportunityAssessmentEntry;
  customerResponseOpportunity: OpportunityAssessmentEntry;
  appointmentBookingOpportunity: OpportunityAssessmentEntry;
  websiteOpportunity: OpportunityAssessmentEntry;
  leadQuality: OpportunityAssessmentEntry;
}

export interface LeadEnrichmentInput {
  lead: {
    firstName?: string | null;
    lastName?: string | null;
    email: string;
    company?: string | null;
    companyDomain?: string | null;
    jobTitle?: string | null;
    industry?: string | null;
    country?: string | null;
    state?: string | null;
    city?: string | null;
    website?: string | null;
  };
  verification?: {
    status: string;
    score: number | null;
    domain?: string | null;
    mxStatus?: string | null;
  } | null;
  websiteIntelligence?: {
    websiteScore: number | null;
    opportunityScore: number | null;
    opportunityPriority?: string | null;
    scoreBreakdown?: Record<string, number> | null;
    technologies?: { name: string; category?: string }[] | null;
    recommendedServices?: { service: string; evidence: string[]; confidence: string }[] | null;
    aiSummary?: string | null;
    personalizationHooks?: string[] | null;
  } | null;
  icpProfile?: {
    targetIndustries: string[];
    targetCountries: string[];
    targetCompanySizes: string[];
    targetJobTitles: string[];
    targetSeniorities: string[];
  } | null;
  serviceCatalog: { name: string; description?: string | null; matchingSignals: string[] }[];
  /// Optional LinkedIn research (Module 17). Absent for callers that predate it.
  linkedInResearch?: LinkedInResearchInput | null;
}

export interface LeadEnrichmentResult {
  summary: string;
  painPointHypotheses: {
    observation: string;
    hypothesis: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    source: 'OBSERVED' | 'INFERRED';
  }[];
  recommendedServices: {
    service: string;
    score: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    evidence: string[];
  }[];
  personalizationHooks: {
    observation: string;
    angle: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }[];
  outreachAngles: {
    angle: string;
    reasoning: string;
    evidence: string[];
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }[];
  companyInsights: {
    description?: string;
    businessType?: string;
  };
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /// Optional per-dimension assessment (Module 17). Providers may omit it.
  opportunityAssessment?: OpportunityAssessment;
}

export interface AIProvider {
  scoreLead(input: { leadId: string; company?: string; title?: string }): Promise<LeadScoreResult>;
  researchCompany(input: { domain: string }): Promise<CompanyResearchResult>;
  personalizeEmail(input: {
    leadId: string;
    campaignId: string;
    context?: string;
  }): Promise<EmailPersonalizationResult>;
  generateEmail(input: {
    leadId: string;
    campaignId: string;
    stepId: string;
  }): Promise<EmailPersonalizationResult>;
  classifyReply(input: { messageId: string; body: string }): Promise<ReplyClassificationResult>;
  suggestReply(input: { threadId: string; body: string }): Promise<ReplySuggestionResult>;
  analyzeDeliverability(input: DeliverabilityAnalysisInput): Promise<DeliverabilityAnalysisResult>;
  analyzeAnalytics(input: AnalyticsAnalysisInput): Promise<AnalyticsAnalysisResult>;
  analyzeWebsite(input: WebsiteAIAnalysisInput): Promise<WebsiteAIAnalysisResult>;
  enrichLead(input: LeadEnrichmentInput): Promise<LeadEnrichmentResult>;
}

export type AIProviderName = 'mock' | 'openai';
