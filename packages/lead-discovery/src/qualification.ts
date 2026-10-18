/// ICP qualification for discovered leads.
///
/// This does NOT introduce a second scoring engine or a second ICP. It reuses
/// the workspace's existing `ICPProfile` row and the pure scoring functions in
/// @signalforge/ai that already power lead enrichment, so a lead scored during
/// discovery and the same lead scored by the enrichment worker agree.
///
/// What is genuinely new here is only the *service*: applying those functions to
/// a staged row, and the pass/fail gate against a minimum score.

import { calculateICPFitScore, calculateLeadQualityScore, calculateProspectScore, inferSeniority } from '@signalforge/ai';
import type { MatchStatus } from '@signalforge/ai';
import { prisma } from '@signalforge/database';
import type { VerificationStatus } from '@signalforge/database';

import type { NormalizedLead } from './normalization.js';

export const QUALIFICATION_VERSION = 'v1';

export type QualificationSignalCode =
  | 'INDUSTRY_MATCH' | 'INDUSTRY_MISMATCH' | 'INDUSTRY_UNKNOWN'
  | 'LOCATION_MATCH' | 'LOCATION_MISMATCH' | 'LOCATION_UNKNOWN'
  | 'COMPANY_SIZE_MATCH' | 'COMPANY_SIZE_MISMATCH' | 'COMPANY_SIZE_UNKNOWN'
  | 'JOB_TITLE_MATCH' | 'JOB_TITLE_MISMATCH' | 'JOB_TITLE_UNKNOWN'
  | 'SENIORITY_MATCH' | 'SENIORITY_MISMATCH' | 'SENIORITY_UNKNOWN'
  | 'EMAIL_VERIFIED' | 'EMAIL_RISKY' | 'EMAIL_INVALID' | 'EMAIL_UNKNOWN' | 'NO_EMAIL'
  | 'WEBSITE_ANALYZED' | 'WEBSITE_NOT_ANALYZED'
  | 'SCORE_ABOVE_THRESHOLD' | 'SCORE_BELOW_THRESHOLD'
  | 'VERIFIED_EMAIL_REQUIRED';

export interface QualificationSignalEntry {
  code: QualificationSignalCode;
  dimension: string;
  status: MatchStatus;
  score: number;
  detail?: string;
}

/// Shape of the ICP configuration the scorers expect. Prisma stores the target
/// lists as `Json[]`, so they are coerced to strings before use.
export interface ResolvedIcpProfile {
  targetIndustries: string[];
  targetCountries: string[];
  targetCompanySizes: string[];
  targetJobTitles: string[];
  targetSeniorities: string[];
  weights?: { industry: number; location: number; companySize: number; jobTitle: number; seniority: number };
  minWebsiteScore: number | null;
  minOpportunityScore: number | null;
  requireVerifiedEmail: boolean;
}

export interface QualificationSignals {
  verificationStatus?: VerificationStatus | null;
  verificationScore?: number | null;
  websiteScore?: number | null;
  opportunityScore?: number | null;
  hasWebsiteAnalysis?: boolean;
  /// Evidence from LinkedIn research (Module 17). Only fields actually
  /// established are set; the scorers treat a missing field as unknown, never
  /// as a mismatch. Weights and thresholds are untouched — this is more input.
  linkedInResearch?: {
    employeeRange?: string | null;
    jobTitle?: string | null;
    profileUrl?: string | null;
    decisionMaker?: boolean | null;
    confidence?: string | null;
  } | null;
}

export interface QualificationOutcome {
  icpFitScore: number;
  leadQualityScore: number;
  prospectScore: number;
  priority: string;
  breakdown: Record<string, number>;
  qualified: boolean;
  reason: string;
  signals: QualificationSignalEntry[];
  version: string;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

/// Load the workspace ICP, or null when none is configured.
/// A missing profile is not an error: the scorers fall back to a neutral 50 so
/// discovery still works on a brand-new workspace.
export async function loadIcpProfile(workspaceId: string): Promise<ResolvedIcpProfile | null> {
  const row = await prisma.iCPProfile.findUnique({ where: { workspaceId } });
  if (!row) return null;

  const weights = row.weights as ResolvedIcpProfile['weights'] | null;
  return {
    targetIndustries: toStringArray(row.targetIndustries),
    targetCountries: toStringArray(row.targetCountries),
    targetCompanySizes: toStringArray(row.targetCompanySizes),
    targetJobTitles: toStringArray(row.targetJobTitles),
    targetSeniorities: toStringArray(row.targetSeniorities),
    weights: weights ?? undefined,
    minWebsiteScore: row.minWebsiteScore,
    minOpportunityScore: row.minOpportunityScore,
    requireVerifiedEmail: row.requireVerifiedEmail,
  };
}

/// Score a normalized lead. Pure — no I/O — so it is directly unit-testable and
/// can be called in a tight loop over a batch without touching the database.
export function qualifyLead(
  lead: NormalizedLead,
  icp: ResolvedIcpProfile | null,
  signals: QualificationSignals = {},
  minScore = 0,
): QualificationOutcome {
  const research = signals.linkedInResearch ?? null;
  // The lead's own title always wins; a researched title only fills a gap.
  const effectiveJobTitle = lead.jobTitle ?? research?.jobTitle ?? null;

  const icpInput = {
    industry: lead.industry ?? null,
    country: lead.country ?? null,
    countryCode: lead.countryCode ?? null,
    jobTitle: effectiveJobTitle,
    company: lead.company ?? null,
    companySize: research?.employeeRange ?? null,
  };

  const icpResult = calculateICPFitScore(icpInput, icp ? { ...icp } : null);

  const verification = signals.verificationStatus
    ? { status: signals.verificationStatus, score: signals.verificationScore ?? null }
    : null;

  const qualityResult = calculateLeadQualityScore(
    {
      firstName: lead.firstName ?? null,
      lastName: lead.lastName ?? null,
      jobTitle: effectiveJobTitle,
      phone: lead.phone ?? null,
      linkedinUrl: research?.profileUrl ?? null,
      company: lead.company ?? null,
      companyDomain: lead.normalizedDomain ?? null,
      industry: lead.industry ?? null,
    },
    verification,
    signals.hasWebsiteAnalysis ?? false,
  );

  const seniority = inferSeniority(effectiveJobTitle);
  const prospect = calculateProspectScore(
    icpResult.score,
    qualityResult.score,
    signals.opportunityScore ?? null,
    seniority,
  );

  // Build machine-readable signals from dimension results.
  const signalEntries: QualificationSignalEntry[] = [];
  const dimensionCodeMap: Record<string, [QualificationSignalCode, QualificationSignalCode, QualificationSignalCode]> = {
    industry: ['INDUSTRY_MATCH', 'INDUSTRY_MISMATCH', 'INDUSTRY_UNKNOWN'],
    location: ['LOCATION_MATCH', 'LOCATION_MISMATCH', 'LOCATION_UNKNOWN'],
    companySize: ['COMPANY_SIZE_MATCH', 'COMPANY_SIZE_MISMATCH', 'COMPANY_SIZE_UNKNOWN'],
    jobTitle: ['JOB_TITLE_MATCH', 'JOB_TITLE_MISMATCH', 'JOB_TITLE_UNKNOWN'],
    seniority: ['SENIORITY_MATCH', 'SENIORITY_MISMATCH', 'SENIORITY_UNKNOWN'],
  };

  for (const [dim, [matchCode, mismatchCode, unknownCode]] of Object.entries(dimensionCodeMap)) {
    const dr = icpResult.dimensionResults[dim];
    if (!dr) continue;
    const code = dr.status === 'MATCH' ? matchCode : dr.status === 'MISMATCH' ? mismatchCode : unknownCode;
    signalEntries.push({ code, dimension: dim, status: dr.status, score: dr.score });
  }

  // Contactability signals.
  const vStatus = signals.verificationStatus?.toUpperCase();
  if (!signals.verificationStatus && !lead.normalizedEmail) {
    signalEntries.push({ code: 'NO_EMAIL', dimension: 'email', status: 'UNKNOWN', score: 0 });
  } else if (vStatus === 'VERIFIED') {
    signalEntries.push({ code: 'EMAIL_VERIFIED', dimension: 'email', status: 'MATCH', score: 100 });
  } else if (vStatus === 'RISKY') {
    signalEntries.push({ code: 'EMAIL_RISKY', dimension: 'email', status: 'UNKNOWN', score: 50 });
  } else if (vStatus === 'INVALID' || vStatus === 'DISPOSABLE' || vStatus === 'ROLE_BASED') {
    signalEntries.push({ code: 'EMAIL_INVALID', dimension: 'email', status: 'MISMATCH', score: 0 });
  } else {
    signalEntries.push({ code: 'EMAIL_UNKNOWN', dimension: 'email', status: 'UNKNOWN', score: 25 });
  }

  // Website signals.
  if (signals.hasWebsiteAnalysis) {
    signalEntries.push({ code: 'WEBSITE_ANALYZED', dimension: 'website', status: 'MATCH', score: 100 });
  } else {
    signalEntries.push({ code: 'WEBSITE_NOT_ANALYZED', dimension: 'website', status: 'UNKNOWN', score: 0 });
  }

  const failures: string[] = [];
  if (prospect.score < minScore) {
    failures.push(`score ${prospect.score} is below the minimum of ${minScore}`);
  }
  if (icp?.requireVerifiedEmail && signals.verificationStatus !== 'VERIFIED') {
    failures.push('a verified email is required');
    signalEntries.push({ code: 'VERIFIED_EMAIL_REQUIRED', dimension: 'gate', status: 'MISMATCH', score: 0 });
  }
  if (icp?.minWebsiteScore != null && (signals.websiteScore ?? 0) < icp.minWebsiteScore) {
    if (signals.hasWebsiteAnalysis) {
      failures.push(`website score below ${icp.minWebsiteScore}`);
    }
  }
  if (icp?.minOpportunityScore != null && signals.opportunityScore != null) {
    if (signals.opportunityScore < icp.minOpportunityScore) {
      failures.push(`opportunity score below ${icp.minOpportunityScore}`);
    }
  }

  const qualified = failures.length === 0;

  // Threshold signal.
  signalEntries.push({
    code: prospect.score >= minScore ? 'SCORE_ABOVE_THRESHOLD' : 'SCORE_BELOW_THRESHOLD',
    dimension: 'threshold',
    status: prospect.score >= minScore ? 'MATCH' : 'MISMATCH',
    score: prospect.score,
    detail: `threshold=${minScore}`,
  });

  return {
    icpFitScore: icpResult.score,
    leadQualityScore: qualityResult.score,
    prospectScore: prospect.score,
    priority: prospect.priority,
    breakdown: { ...icpResult.breakdown, ...prospect.breakdown },
    qualified,
    reason: qualified
      ? `Prospect score ${prospect.score} (${prospect.priority})`
      : `Not qualified: ${failures.join('; ')}`,
    signals: signalEntries,
    version: QUALIFICATION_VERSION,
  };
}

/// AI-opportunity indicator derived strictly from observed website signals.
///
/// Returns UNKNOWN when no website was analyzed — the absence of evidence is
/// never reported as an opportunity, because claiming a company "has no chatbot"
/// when we never looked is simply wrong.
export function deriveAiOpportunity(signals: {
  hasWebsiteAnalysis?: boolean;
  hasChatbot?: boolean | null;
  hasLiveChat?: boolean | null;
  hasBookingWidget?: boolean | null;
  hasContactForm?: boolean | null;
  opportunityScore?: number | null;
}): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  if (!signals.hasWebsiteAnalysis) return 'UNKNOWN';

  let gaps = 0;
  if (signals.hasChatbot === false) gaps += 1;
  if (signals.hasLiveChat === false) gaps += 1;
  if (signals.hasBookingWidget === false) gaps += 1;
  // A contact form with no automation around it means manual lead handling.
  if (signals.hasContactForm === true && signals.hasChatbot === false) gaps += 1;

  if (gaps >= 3) return 'HIGH';
  if (gaps === 2) return 'MEDIUM';
  return 'LOW';
}
