type Seniority = 'EXECUTIVE' | 'VP' | 'DIRECTOR' | 'MANAGER' | 'INDIVIDUAL_CONTRIBUTOR' | 'UNKNOWN';
type ProspectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export type MatchStatus = 'MATCH' | 'MISMATCH' | 'UNKNOWN';
export interface DimensionResult { score: number; status: MatchStatus }

export function inferSeniority(jobTitle: string | null | undefined): Seniority {
  if (!jobTitle) return 'UNKNOWN';
  const t = jobTitle.toLowerCase();

  if (/\b(ceo|cto|cfo|coo|cmo|cio|ciso|founder|co-founder|owner|president|principal|partner|chairman)\b/.test(t)) return 'EXECUTIVE';
  if (/\b(vp|vice\s*president|svp|evp|avp)\b/.test(t)) return 'VP';
  if (/\bdirector\b/.test(t)) return 'DIRECTOR';
  if (/\b(manager|head|lead|team\s*lead|supervisor)\b/.test(t)) return 'MANAGER';
  return 'INDIVIDUAL_CONTRIBUTOR';
}

export function inferDepartment(jobTitle: string | null | undefined): string | null {
  if (!jobTitle) return null;
  const t = jobTitle.toLowerCase();

  if (/\b(sales|account\s*executive|business\s*development|bdr|sdr|revenue)\b/.test(t)) return 'Sales';
  if (/\b(marketing|growth|brand|content|communications|pr|demand\s*gen)\b/.test(t)) return 'Marketing';
  if (/\b(engineer|developer|software|devops|sre|platform|architect|technical|it|infrastructure|data\s*scientist|data\s*engineer)\b/.test(t)) return 'Engineering';
  if (/\b(operations|ops|supply\s*chain|logistics|procurement)\b/.test(t)) return 'Operations';
  if (/\b(finance|accounting|controller|treasurer|bookkeeper)\b/.test(t)) return 'Finance';
  if (/\b(hr|human\s*resources|people|talent|recruiting|recruiter)\b/.test(t)) return 'HR';
  if (/\b(ceo|cto|cfo|coo|cmo|founder|co-founder|owner|president|chairman|chief)\b/.test(t)) return 'Executive';
  if (/\b(product|ux|ui|design)\b/.test(t)) return 'Product';
  if (/\b(legal|compliance|counsel|attorney)\b/.test(t)) return 'Legal';
  if (/\b(customer\s*success|support|service|cx)\b/.test(t)) return 'Customer Success';
  return null;
}

interface ICPProfile {
  targetIndustries: string[];
  targetCountries: string[];
  targetCompanySizes: string[];
  targetJobTitles: string[];
  targetSeniorities: string[];
  weights?: { industry: number; location: number; companySize: number; jobTitle: number; seniority: number };
}

interface ICPLead {
  industry?: string | null;
  country?: string | null;
  countryCode?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  /// Researched employee range, e.g. "11-50 employees" (Module 17). Absent = unknown.
  companySize?: string | null;
}

/// A parsed employee range. `max: null` means open-ended ("10,001+").
export interface EmployeeRange {
  min: number;
  max: number | null;
}

function parseCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw.replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a LinkedIn-style employee range into numeric bounds.
 *
 * Accepts "11-50 employees", "51-200", "1,001-5,000", "10,001+", "1-10",
 * "self-employed" / "myself only" (1-1) and a bare count ("201" → 201-201).
 * Anything else returns null so callers can fall back to string comparison
 * rather than guessing.
 */
export function parseEmployeeRange(value: string | null | undefined): EmployeeRange | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;

  if (/\b(self[\s-]?employed|myself only|sole proprietor|freelancer?)\b/.test(text)) {
    return { min: 1, max: 1 };
  }

  const range = /(\d[\d,]*)\s*(?:-|–|—|to)\s*(\d[\d,]*)/.exec(text);
  if (range) {
    const a = parseCount(range[1]);
    const b = parseCount(range[2]);
    if (a === null || b === null) return null;
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }

  const openEnded = /(\d[\d,]*)\s*\+/.exec(text);
  if (openEnded) {
    const min = parseCount(openEnded[1]);
    return min === null ? null : { min, max: null };
  }

  const single = /^(\d[\d,]*)\s*(?:employees?|people|staff)?$/.exec(text);
  if (single) {
    const count = parseCount(single[1]);
    return count === null ? null : { min: count, max: count };
  }

  return null;
}

/**
 * Whether a researched company size satisfies one ICP target size.
 *
 * Both sides are parsed; parsed ranges match when they overlap. When either
 * side cannot be parsed the comparison falls back to case-insensitive string
 * equality, so free-text ICP values ("Enterprise") still match themselves.
 */
export function companySizeMatches(
  leadSize: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const lead = leadSize?.trim();
  const goal = target?.trim();
  if (!lead || !goal) return false;

  const a = parseEmployeeRange(lead);
  const b = parseEmployeeRange(goal);
  if (a && b) {
    const aMax = a.max ?? Number.POSITIVE_INFINITY;
    const bMax = b.max ?? Number.POSITIVE_INFINITY;
    return a.min <= bMax && b.min <= aMax;
  }

  return lead.toLowerCase() === goal.toLowerCase();
}

export function calculateICPFitScore(
  lead: ICPLead,
  icpProfile: ICPProfile | null,
): { score: number; breakdown: Record<string, number>; dimensionResults: Record<string, DimensionResult> } {
  if (!icpProfile) {
    const neutral: DimensionResult = { score: 50, status: 'UNKNOWN' };
    return {
      score: 50,
      breakdown: { industry: 50, location: 50, companySize: 50, jobTitle: 50, seniority: 50 },
      dimensionResults: { industry: neutral, location: neutral, companySize: neutral, jobTitle: neutral, seniority: neutral },
    };
  }

  const w = icpProfile.weights ?? { industry: 25, location: 15, companySize: 15, jobTitle: 25, seniority: 20 };

  let industryResult: DimensionResult;
  if (icpProfile.targetIndustries.length === 0) {
    industryResult = { score: 100, status: 'MATCH' };
  } else if (!lead.industry) {
    industryResult = { score: 50, status: 'UNKNOWN' };
  } else if (icpProfile.targetIndustries.some(i => i.toLowerCase() === lead.industry!.toLowerCase())) {
    industryResult = { score: 100, status: 'MATCH' };
  } else {
    industryResult = { score: 0, status: 'MISMATCH' };
  }

  let locationResult: DimensionResult;
  if (icpProfile.targetCountries.length === 0) {
    locationResult = { score: 100, status: 'MATCH' };
  } else if (!lead.country && !lead.countryCode) {
    locationResult = { score: 50, status: 'UNKNOWN' };
  } else if (
    (lead.country && icpProfile.targetCountries.some(c => c.toLowerCase() === lead.country!.toLowerCase()))
    || (lead.countryCode && icpProfile.targetCountries.some(c => c.toLowerCase() === lead.countryCode!.toLowerCase()))
  ) {
    locationResult = { score: 100, status: 'MATCH' };
  } else {
    locationResult = { score: 0, status: 'MISMATCH' };
  }

  let companySizeResult: DimensionResult;
  if (icpProfile.targetCompanySizes.length === 0) {
    companySizeResult = { score: 100, status: 'MATCH' };
  } else if (!lead.companySize?.trim()) {
    companySizeResult = { score: 50, status: 'UNKNOWN' };
  } else if (icpProfile.targetCompanySizes.some(size => companySizeMatches(lead.companySize, size))) {
    companySizeResult = { score: 100, status: 'MATCH' };
  } else {
    companySizeResult = { score: 0, status: 'MISMATCH' };
  }

  let jobTitleResult: DimensionResult;
  if (icpProfile.targetJobTitles.length === 0) {
    jobTitleResult = { score: 100, status: 'MATCH' };
  } else if (!lead.jobTitle) {
    jobTitleResult = { score: 50, status: 'UNKNOWN' };
  } else if (icpProfile.targetJobTitles.some(t => lead.jobTitle!.toLowerCase().includes(t.toLowerCase()))) {
    jobTitleResult = { score: 100, status: 'MATCH' };
  } else {
    jobTitleResult = { score: 0, status: 'MISMATCH' };
  }

  const seniority = inferSeniority(lead.jobTitle);
  let seniorityResult: DimensionResult;
  if (icpProfile.targetSeniorities.length === 0) {
    seniorityResult = { score: 100, status: 'MATCH' };
  } else if (seniority === 'UNKNOWN') {
    seniorityResult = { score: 50, status: 'UNKNOWN' };
  } else if (icpProfile.targetSeniorities.includes(seniority)) {
    seniorityResult = { score: 100, status: 'MATCH' };
  } else {
    seniorityResult = { score: 0, status: 'MISMATCH' };
  }

  const breakdown = {
    industry: industryResult.score,
    location: locationResult.score,
    companySize: companySizeResult.score,
    jobTitle: jobTitleResult.score,
    seniority: seniorityResult.score,
  };
  const dimensionResults = {
    industry: industryResult,
    location: locationResult,
    companySize: companySizeResult,
    jobTitle: jobTitleResult,
    seniority: seniorityResult,
  };
  const score = Math.round(
    (industryResult.score * w.industry + locationResult.score * w.location + companySizeResult.score * w.companySize
      + jobTitleResult.score * w.jobTitle + seniorityResult.score * w.seniority) / 100,
  );

  return { score: Math.max(0, Math.min(100, score)), breakdown, dimensionResults };
}

interface QualityLead {
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  company?: string | null;
  companyDomain?: string | null;
  industry?: string | null;
}

interface Verification {
  status: string;
  score?: number | null;
}

export function calculateLeadQualityScore(
  lead: QualityLead,
  verification: Verification | null | undefined,
  hasWebsiteAnalysis: boolean,
): { score: number; breakdown: Record<string, number> } {
  let emailScore: number;
  const vStatus = verification?.status?.toUpperCase();
  if (vStatus === 'VERIFIED') emailScore = 100;
  else if (vStatus === 'RISKY') emailScore = 50;
  else if (vStatus === 'UNKNOWN' || !verification) emailScore = 25;
  else emailScore = 0;

  const contactFields = [lead.firstName, lead.lastName, lead.jobTitle, lead.phone, lead.linkedinUrl];
  const contactCompleteness = Math.round((contactFields.filter(Boolean).length / contactFields.length) * 100);

  const companyFields = [lead.company, lead.companyDomain, lead.industry];
  const companyCompleteness = Math.round((companyFields.filter(Boolean).length / companyFields.length) * 100);

  const hasWebsite = !!(lead.companyDomain || lead.company);
  const websitePresence = hasWebsiteAnalysis ? 100 : hasWebsite ? 50 : 0;

  const breakdown = {
    emailVerification: emailScore,
    contactCompleteness,
    companyCompleteness,
    websitePresence,
  };
  const score = Math.round((emailScore + contactCompleteness + companyCompleteness + websitePresence) / 4);

  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

export function calculateProspectScore(
  icpFitScore: number,
  leadQualityScore: number,
  opportunityScore: number | null,
  seniority: Seniority,
): { score: number; breakdown: Record<string, number>; priority: ProspectPriority } {
  const contactRelevanceMap: Record<Seniority, number> = {
    EXECUTIVE: 100,
    VP: 90,
    DIRECTOR: 80,
    MANAGER: 60,
    INDIVIDUAL_CONTRIBUTOR: 40,
    UNKNOWN: 30,
  };
  const contactRelevance = contactRelevanceMap[seniority];
  const opp = opportunityScore ?? 50;

  const score = Math.round(icpFitScore * 0.35 + leadQualityScore * 0.25 + opp * 0.25 + contactRelevance * 0.15);
  const clamped = Math.max(0, Math.min(100, score));

  let priority: ProspectPriority;
  if (clamped >= 80) priority = 'VERY_HIGH';
  else if (clamped >= 60) priority = 'HIGH';
  else if (clamped >= 40) priority = 'MEDIUM';
  else priority = 'LOW';

  const breakdown = { icpFit: Math.round(icpFitScore * 0.35), leadQuality: Math.round(leadQualityScore * 0.25), opportunity: Math.round(opp * 0.25), contactRelevance: Math.round(contactRelevance * 0.15) };

  return { score: clamped, breakdown, priority };
}

interface DynVarLead {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email: string;
  company?: string | null;
  companyDomain?: string | null;
  jobTitle?: string | null;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

interface DynVarEnrichment {
  aiSummary?: string | null;
  painPointHypotheses?: { observation: string; hypothesis: string }[] | null;
  recommendedServices?: { service: string; score: number }[] | null;
  personalizationHooks?: { observation: string; angle: string }[] | null;
  outreachAngles?: { angle: string; reasoning: string }[] | null;
}

interface DynVarWebsite {
  websiteScore?: number | null;
  opportunityScore?: number | null;
  aiSummary?: string | null;
}

export function buildDynamicVariables(
  lead: DynVarLead,
  enrichment: DynVarEnrichment | null,
  websiteAnalysis: DynVarWebsite | null,
): Record<string, string> {
  const vars: Record<string, string> = {};

  vars['first_name'] = lead.firstName ?? '';
  vars['last_name'] = lead.lastName ?? '';
  vars['full_name'] = lead.fullName ?? ([lead.firstName, lead.lastName].filter(Boolean).join(' ') || '');
  vars['email'] = lead.email;
  vars['company_name'] = lead.company ?? '';
  vars['company_domain'] = lead.companyDomain ?? '';
  vars['job_title'] = lead.jobTitle ?? '';
  vars['industry'] = lead.industry ?? '';
  vars['city'] = lead.city ?? '';
  vars['state'] = lead.state ?? '';
  vars['country'] = lead.country ?? '';

  if (websiteAnalysis) {
    vars['website_score'] = websiteAnalysis.websiteScore != null ? String(websiteAnalysis.websiteScore) : '';
    vars['opportunity_score'] = websiteAnalysis.opportunityScore != null ? String(websiteAnalysis.opportunityScore) : '';
  }

  if (enrichment) {
    const topService = enrichment.recommendedServices?.[0];
    vars['recommended_service'] = topService?.service ?? '';

    const topPain = enrichment.painPointHypotheses?.[0];
    vars['pain_point'] = topPain?.hypothesis ?? '';

    const topHook = enrichment.personalizationHooks?.[0];
    vars['personalization_hook'] = topHook?.angle ?? '';

    const topAngle = enrichment.outreachAngles?.[0];
    vars['outreach_angle'] = topAngle?.angle ?? '';

    vars['top_opportunity'] = (topService?.service ?? topPain?.hypothesis) ?? '';
  }

  return vars;
}
