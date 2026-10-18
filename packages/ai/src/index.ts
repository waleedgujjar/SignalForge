export type {
  AIProvider,
  AIProviderName,
  AnalyticsAnalysisInput,
  AnalyticsAnalysisResult,
  CompanyResearchResult,
  DeliverabilityAnalysisInput,
  DeliverabilityAnalysisResult,
  EmailPersonalizationResult,
  LeadEnrichmentInput,
  LeadEnrichmentResult,
  LeadScoreResult,
  LinkedInResearchInput,
  OpportunityAssessment,
  OpportunityAssessmentEntry,
  OpportunityLevel,
  ReplyClassificationResult,
  ReplySuggestionResult,
  ResearchVerificationLabel,
  WebsiteAIAnalysisInput,
  WebsiteAIAnalysisResult,
} from './types.js';

export { MockAIProvider } from './mock-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { createAIProvider, checkAIHealth } from './factory.js';
export { createRequestTimeout, AI_TIMEOUT_MS, AI_HEAVY_TIMEOUT_MS } from './timeout.js';
export {
  inferSeniority,
  inferDepartment,
  calculateICPFitScore,
  calculateLeadQualityScore,
  calculateProspectScore,
  buildDynamicVariables,
  parseEmployeeRange,
  companySizeMatches,
} from './scoring.js';
export type { EmployeeRange, MatchStatus, DimensionResult } from './scoring.js';
