import type {
  AIProvider,
  CompanyResearchResult,
  AnalyticsAnalysisInput,
  AnalyticsAnalysisResult,
  DeliverabilityAnalysisInput,
  DeliverabilityAnalysisResult,
  EmailPersonalizationResult,
  LeadCategorizationInput,
  LeadCategorizationResult,
  LeadEnrichmentInput,
  LeadEnrichmentResult,
  LeadScoreResult,
  OpportunityAssessment,
  OpportunityAssessmentEntry,
  OpportunityLevel,
  ReplyClassificationResult,
  ReplySuggestionResult,
  ResearchVerificationLabel,
  WebsiteAIAnalysisInput,
  WebsiteAIAnalysisResult,
} from './types.js';
import { companySizeMatches } from './scoring.js';

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function assess(
  value: OpportunityLevel,
  status: ResearchVerificationLabel,
  evidence: string[],
): OpportunityAssessmentEntry {
  return { value, status, evidence };
}

/// The only honest answer when nothing was established: no value, no evidence.
function unknown(): OpportunityAssessmentEntry {
  return { value: null, status: 'UNKNOWN', evidence: [] };
}

function buildOpportunityAssessment(
  input: LeadEnrichmentInput,
  dataPoints: number,
  recommendedServices: LeadEnrichmentResult['recommendedServices'],
): OpportunityAssessment {
  const lead = input.lead;
  const websiteScore = input.websiteIntelligence?.websiteScore ?? null;
  const research = input.linkedInResearch ?? null;
  const researchVerified = research?.verification === 'VERIFIED';

  const websiteOpportunity: OpportunityAssessmentEntry =
    input.websiteIntelligence && websiteScore !== null
      ? assess(
          websiteScore < 50 ? 'HIGH' : websiteScore < 75 ? 'MEDIUM' : 'LOW',
          'INFERRED',
          [`Website score ${websiteScore}/100`],
        )
      : unknown();

  const aiReceptionistOpportunity = unknown();
  const customerResponseOpportunity = unknown();
  const appointmentBookingOpportunity = unknown();

  let icpFit: OpportunityAssessmentEntry = unknown();
  const icp = input.icpProfile ?? null;
  if (icp) {
    const evidence: string[] = [];
    let evaluated = 0;
    let matched = 0;

    if (icp.targetIndustries.length > 0 && lead.industry) {
      evaluated += 1;
      const industry = lead.industry;
      if (icp.targetIndustries.some(target => target.toLowerCase() === industry.toLowerCase())) {
        matched += 1;
        evidence.push(`Industry "${industry}" is an ICP target industry`);
      } else {
        evidence.push(`Industry "${industry}" is not an ICP target industry`);
      }
    }

    const employeeRange = research?.company?.employeeRange ?? null;
    if (icp.targetCompanySizes.length > 0 && employeeRange) {
      evaluated += 1;
      if (icp.targetCompanySizes.some(size => companySizeMatches(employeeRange, size))) {
        matched += 1;
        evidence.push(`LinkedIn employee range "${employeeRange}" matches an ICP company size`);
      } else {
        evidence.push(`LinkedIn employee range "${employeeRange}" is outside the ICP company sizes`);
      }
    }

    if (evaluated > 0) {
      icpFit = assess(matched === evaluated ? 'HIGH' : matched > 0 ? 'MEDIUM' : 'LOW', 'INFERRED', evidence);
    }
  }

  const topService = recommendedServices[0];
  const serviceFit: OpportunityAssessmentEntry = topService
    ? assess(
        topService.score >= 80 ? 'HIGH' : topService.score >= 60 ? 'MEDIUM' : 'LOW',
        'INFERRED',
        [`Top recommended service "${topService.service}" scored ${topService.score}/100`],
      )
    : unknown();

  const researchedTitle = research?.person?.title ?? null;
  const qualityPoints = dataPoints + (researchedTitle ? 1 : 0);
  let leadQuality: OpportunityAssessmentEntry = unknown();
  if (qualityPoints > 0) {
    const evidence = [`${dataPoints} lead data point${dataPoints === 1 ? '' : 's'} provided`];
    if (researchedTitle) {
      evidence.push(`LinkedIn research title "${researchedTitle}" (${research?.verification ?? 'UNKNOWN'})`);
    }
    leadQuality = assess(
      qualityPoints >= 4 ? 'HIGH' : qualityPoints >= 2 ? 'MEDIUM' : 'LOW',
      researchedTitle && researchVerified ? 'VERIFIED' : 'INFERRED',
      evidence,
    );
  }

  return {
    icpFit,
    serviceFit,
    aiReceptionistOpportunity,
    customerResponseOpportunity,
    appointmentBookingOpportunity,
    websiteOpportunity,
    leadQuality,
  };
}

export class MockAIProvider implements AIProvider {
  async categorizeLeads(_input: LeadCategorizationInput): Promise<LeadCategorizationResult> {
    // The mock never guesses categories; rule-based categorization already ran.
    return { categories: [] };
  }

  async scoreLead(input: { leadId: string; company?: string; title?: string }): Promise<LeadScoreResult> {
    const score = 60 + (hashString(input.leadId) % 41);
    const category =
      score >= 85 ? 'HOT' : score >= 70 ? 'WARM' : score >= 50 ? 'COLD' : 'UNQUALIFIED';

    return {
      score,
      category,
      reasons: [
        `Industry fit aligned with ICP (${input.company ?? 'unknown company'})`,
        `Role relevance for ${input.title ?? 'target contact'}`,
        'Deterministic mock score for development',
      ],
    };
  }

  async researchCompany(input: { domain: string }): Promise<CompanyResearchResult> {
    return {
      summary: `${input.domain} appears to operate in B2B services with public web presence.`,
      signals: ['Public website', 'Business email domain', 'Standard SaaS stack indicators'],
      industryFit: 72,
    };
  }

  async personalizeEmail(input: {
    leadId: string;
    campaignId: string;
    context?: string;
  }): Promise<EmailPersonalizationResult> {
    return {
      subject: `Quick idea for ${input.leadId.slice(0, 8)}`,
      body: `Hi there,\n\nI noticed ${input.context ?? 'your team is scaling outbound efforts'}. SignalForge helps turn the right signals into sales conversations.\n\nWould a brief chat next week make sense?\n\nBest,\nSignalForge`,
    };
  }

  async generateEmail(input: {
    leadId: string;
    campaignId: string;
    stepId: string;
  }): Promise<EmailPersonalizationResult> {
    return {
      subject: `Following up — campaign ${input.campaignId.slice(0, 6)}`,
      body: `Hello,\n\nThis is step ${input.stepId} for lead ${input.leadId.slice(0, 8)}.\n\nHappy to share how teams improve reply rates with better personalization.\n\nThanks,`,
    };
  }

  async classifyReply(input: { messageId: string; body: string }): Promise<ReplyClassificationResult> {
    const normalized = input.body.toLowerCase();
    let category: ReplyClassificationResult['category'] = 'UNKNOWN';

    if (normalized.includes('unsubscribe')) category = 'UNSUBSCRIBE';
    else if (normalized.includes('wrong person') || normalized.includes('wrong contact')) category = 'WRONG_PERSON';
    else if (normalized.includes('refer') || normalized.includes('try reaching')) category = 'REFERRAL';
    else if (normalized.includes('meeting') || normalized.includes('calendar')) category = 'NEEDS_FOLLOW_UP';
    else if (normalized.includes('out of office') || normalized.includes('ooo')) category = 'OOO';
    else if (normalized.includes('not interested')) category = 'NOT_INTERESTED';
    else if (normalized.includes('interested')) category = 'INTERESTED';
    else if (normalized.includes('?')) category = 'QUESTION';
    else if (normalized.includes('thanks') || normalized.includes('great')) category = 'POSITIVE';
    else if (normalized.includes('no ') || normalized.includes('stop')) category = 'NEGATIVE';

    const sentiment: ReplyClassificationResult['sentiment'] =
      category === 'POSITIVE' || category === 'INTERESTED' || category === 'REFERRAL'
        ? 'POSITIVE'
        : category === 'NEGATIVE' || category === 'NOT_INTERESTED' || category === 'UNSUBSCRIBE'
          ? 'NEGATIVE'
          : 'NEUTRAL';

    return {
      category,
      confidence: 0.91,
      sentiment,
      summary: `Mock classification for message ${input.messageId.slice(0, 8)}`,
      suggestedAction: suggestedActionForCategory(category),
    };
  }

  async suggestReply(input: { threadId: string; body: string }): Promise<ReplySuggestionResult> {
    return {
      draft: `Thanks for your reply on thread ${input.threadId.slice(0, 8)}. Happy to share more details and suggest a quick call.`,
      tone: 'professional',
    };
  }

  async analyzeDeliverability(
    input: DeliverabilityAnalysisInput,
  ): Promise<DeliverabilityAnalysisResult> {
    const investigationAreas: string[] = [];
    const recommendations: string[] = [];

    if (input.rates.bounceRate > 0) {
      investigationAreas.push(`Bounce rate of ${input.rates.bounceRate}% across ${input.metrics.attempted} attempts`);
      recommendations.push('Review the source and freshness of recently imported contacts.');
    }
    if (input.rates.failureRate > 0) {
      investigationAreas.push(`Send failure rate of ${input.rates.failureRate}%`);
      recommendations.push('Check SMTP credentials and connection limits for this mailbox.');
    }
    if (input.authentication) {
      const failing = Object.entries(input.authentication)
        .filter(([, status]) => status === 'FAIL' || status === 'INVALID')
        .map(([key]) => key.toUpperCase());
      if (failing.length > 0) {
        investigationAreas.push(`Authentication checks reporting issues: ${failing.join(', ')}`);
      }
    }
    if (!input.complaintDataAvailable) {
      investigationAreas.push('Complaint data is unavailable for this mailbox or provider.');
    }

    return {
      summary:
        `${input.mailboxLabel} has a health score of ${input.healthScore} (${input.tier}) with a ` +
        `${input.rates.bounceRate}% bounce rate and ${input.rates.replyRate}% unique reply rate ` +
        `over ${input.metrics.attempted} attempted sends.`,
      riskScore: Math.max(0, 100 - input.healthScore),
      investigationAreas,
      recommendations,
    };
  }

  async analyzeAnalytics(input: AnalyticsAnalysisInput): Promise<AnalyticsAnalysisResult> {
    const highlights: string[] = [];
    const concerns: string[] = [];
    const recommendations: string[] = [];

    if (input.rates.deliveryRate >= 95) {
      highlights.push(`Delivery rate of ${input.rates.deliveryRate}% is healthy.`);
    }
    if (input.leads.positiveReplies > 0) {
      highlights.push(`${input.leads.positiveReplies} positive replies from ${input.leads.replied} replying leads.`);
    }
    if (input.rates.bounceRate >= 2) {
      concerns.push(`Bounce rate of ${input.rates.bounceRate}% is above the 2% comfort threshold.`);
      recommendations.push('Verify leads before enrollment to reduce bounces.');
    }
    if (input.rates.unsubscribeRate >= 1) {
      concerns.push(`Unsubscribe rate of ${input.rates.unsubscribeRate}% suggests a targeting mismatch.`);
      recommendations.push('Tighten targeting filters or revise the opening message.');
    }
    if (input.leads.meetings === 0 && input.leads.positiveReplies > 0) {
      recommendations.push('Record meetings as outcomes so conversion from positive replies can be measured.');
    }

    return {
      summary:
        `Over ${input.periodLabel}, ${input.email.sent} emails were sent to ${input.leads.contacted} contacted leads, ` +
        `producing ${input.email.replies} replies and ${input.leads.meetings} recorded meetings. ` +
        `Not tracked: ${input.unavailableMetrics.join(', ')}.`,
      highlights,
      concerns,
      recommendations,
    };
  }

  async enrichLead(input: LeadEnrichmentInput): Promise<LeadEnrichmentResult> {
    const lead = input.lead;
    const company = lead.company ?? lead.companyDomain ?? 'the company';
    const hasWebsite = !!input.websiteIntelligence;
    const websiteScore = input.websiteIntelligence?.websiteScore ?? null;

    const dataPoints = [lead.company, lead.jobTitle, lead.industry, lead.country, lead.website].filter(Boolean).length;
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = dataPoints >= 4 ? 'HIGH' : dataPoints >= 2 ? 'MEDIUM' : 'LOW';

    const painPoints: LeadEnrichmentResult['painPointHypotheses'] = [];
    if (hasWebsite && websiteScore !== null && websiteScore < 50) {
      painPoints.push({ observation: `Website scores ${websiteScore}/100`, hypothesis: `${company} may be losing leads due to poor website quality`, confidence: 'HIGH', source: 'OBSERVED' });
    }
    if (lead.industry) {
      painPoints.push({ observation: `Operates in ${lead.industry}`, hypothesis: `${lead.industry} companies often struggle with digital lead generation`, confidence: 'MEDIUM', source: 'INFERRED' });
    }
    if (painPoints.length === 0) {
      painPoints.push({ observation: 'Limited data available', hypothesis: `${company} may benefit from outbound sales optimization`, confidence: 'LOW', source: 'INFERRED' });
    }

    const recommendedServices: LeadEnrichmentResult['recommendedServices'] = [];
    for (const svc of input.serviceCatalog) {
      const score = 50 + (hashString(svc.name + lead.email) % 51);
      recommendedServices.push({ service: svc.name, score, confidence: score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW', evidence: [`Matched for ${company}`] });
    }
    recommendedServices.sort((a, b) => b.score - a.score);

    const hooks: LeadEnrichmentResult['personalizationHooks'] = [];
    if (lead.jobTitle) hooks.push({ observation: `Role: ${lead.jobTitle}`, angle: `Reference their specific responsibilities as ${lead.jobTitle}`, confidence: 'HIGH' });
    if (hasWebsite) hooks.push({ observation: `Has web presence at ${lead.website ?? lead.companyDomain}`, angle: 'Reference specific website observations', confidence: 'MEDIUM' });
    if (hooks.length === 0) hooks.push({ observation: `Works at ${company}`, angle: `Mention ${company} by name for personalization`, confidence: 'LOW' });

    const angles: LeadEnrichmentResult['outreachAngles'] = [
      { angle: 'Problem-Solution', reasoning: `Lead ${company} to discuss how your services solve their specific challenges`, evidence: painPoints.map(p => p.observation), confidence: 'MEDIUM' },
    ];
    if (hasWebsite && websiteScore !== null && websiteScore < 60) {
      angles.push({ angle: 'Website Audit Offer', reasoning: `Their website scores ${websiteScore}/100 — offer a free audit`, evidence: [`Website score: ${websiteScore}`], confidence: 'HIGH' });
    }

    return {
      summary: `${lead.firstName ?? 'Contact'} at ${company} is a ${lead.jobTitle ?? 'professional'} in ${lead.industry ?? 'their industry'}. ${hasWebsite ? `Their website scores ${websiteScore}/100. ` : ''}Based on available data, there ${painPoints.length > 1 ? 'are several potential' : 'is a potential'} pain point${painPoints.length > 1 ? 's' : ''} that align with offered services. ${confidence === 'HIGH' ? 'Strong data coverage supports high-confidence recommendations.' : 'Additional data would improve recommendation confidence.'}`,
      painPointHypotheses: painPoints,
      recommendedServices: recommendedServices.slice(0, 5),
      personalizationHooks: hooks,
      outreachAngles: angles,
      companyInsights: { description: `${company} operates in the ${lead.industry ?? 'general'} sector`, businessType: lead.industry ? 'B2B' : undefined },
      confidence,
      opportunityAssessment: buildOpportunityAssessment(input, dataPoints, recommendedServices),
    };
  }

  async analyzeWebsite(input: WebsiteAIAnalysisInput): Promise<WebsiteAIAnalysisResult> {
    const weakAreas = Object.entries(input.categoryScores)
      .filter(([, v]) => v < 50)
      .map(([k]) => k);

    return {
      summary: `${input.domain} scores ${input.websiteScore}/100 overall. ${weakAreas.length > 0 ? `Key improvement areas: ${weakAreas.join(', ')}.` : 'Website performs reasonably well across all areas.'}`,
      keyIssues: input.keyIssues.slice(0, 5),
      opportunities: [
        { service: 'Website Optimization', evidence: `Website score is ${input.websiteScore}/100`, confidence: input.websiteScore < 50 ? 'HIGH' as const : 'MEDIUM' as const },
        ...(input.conversionGaps.length > 0 ? [{ service: 'Lead Generation', evidence: input.conversionGaps[0]!, confidence: 'MEDIUM' as const }] : []),
      ],
      personalizationHooks: [
        `Their website uses ${input.technologies.slice(0, 2).join(' and ') || 'a basic stack'}`,
        `Modernity score is ${input.modernityScore}/100 — ${input.modernityScore < 40 ? 'showing signs of an outdated site' : 'relatively modern'}`,
      ],
    };
  }
}

function suggestedActionForCategory(
  category: ReplyClassificationResult['category'],
): string {
  switch (category) {
    case 'INTERESTED':
    case 'REFERRAL':
      return 'Respond promptly and schedule next step';
    case 'NOT_INTERESTED':
      return 'Acknowledge and close thread';
    case 'QUESTION':
      return 'Provide a direct answer';
    case 'NEEDS_FOLLOW_UP':
      return 'Schedule follow-up';
    case 'OOO':
      return 'Defer follow-up until return';
    case 'UNSUBSCRIBE':
      return 'Add lead to suppression list and stop campaign';
    case 'WRONG_PERSON':
      return 'Update contact or close thread';
    default:
      return 'Review manually';
  }
}
