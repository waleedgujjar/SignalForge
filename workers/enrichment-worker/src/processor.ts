import { prisma } from '@signalforge/database';
import {
  type AIProvider,
  type LeadEnrichmentInput,
  inferSeniority,
  inferDepartment,
  calculateICPFitScore,
  calculateLeadQualityScore,
  calculateProspectScore,
  buildDynamicVariables,
} from '@signalforge/ai';
import { createHash } from 'node:crypto';
import { publishWorkflowEvent } from '@signalforge/queue';
import { toLinkedInResearchInput, pickResearchedTitle, pickEmployeeRange, researchCacheKey } from './linkedin-research.js';

export interface EnrichmentJobData {
  workspaceId: string;
  leadId: string;
  enrichmentId: string;
  forceRefresh?: boolean;
}

function toJson(value: unknown): ReturnType<typeof JSON.parse> {
  return JSON.parse(JSON.stringify(value));
}

function computeInputHash(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

export async function processEnrichmentJob(
  data: EnrichmentJobData,
  aiProvider: AIProvider,
): Promise<{ enrichmentId: string; status: string }> {
  const { enrichmentId, leadId, workspaceId } = data;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        verification: true,
        websiteAnalyses: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!lead || lead.workspaceId !== workspaceId) {
      await prisma.leadEnrichment.update({
        where: { id: enrichmentId },
        data: { status: 'FAILED', errorMessage: 'Lead not found or workspace mismatch', lastAttemptAt: new Date() },
      });
      return { enrichmentId, status: 'FAILED' };
    }

    // Module 17: latest usable LinkedIn research per type. Evidence only -
    // the scorers and the AI decide what it means; a missing row stays UNKNOWN.
    const linkedInRows = await prisma.leadResearch.findMany({
      where: {
        leadId,
        workspaceId,
        source: 'LINKEDIN',
        status: { in: ['COMPLETED', 'PARTIAL'] },
        researchType: { in: ['COMPANY', 'PERSON'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const companyResearch = linkedInRows.find((row) => row.researchType === 'COMPANY') ?? null;
    const personResearch = linkedInRows.find((row) => row.researchType === 'PERSON') ?? null;
    // Fill-gaps only: a researched title is used when the lead has none; the Lead row is not modified here.
    const effectiveJobTitle = lead.jobTitle ?? pickResearchedTitle(personResearch);
    const employeeRange = pickEmployeeRange(companyResearch);

    const icpProfile = await prisma.iCPProfile.findUnique({ where: { workspaceId } });
    const serviceCatalog = await prisma.serviceCatalogEntry.findMany({
      where: { workspaceId, enabled: true },
      orderBy: { sortOrder: 'asc' },
    });

    const websiteAnalysis = lead.websiteAnalyses[0] ?? null;
    const verification = lead.verification;

    const inputData = {
      lead: { email: lead.email, firstName: lead.firstName, lastName: lead.lastName, company: lead.company, companyDomain: lead.companyDomain, jobTitle: lead.jobTitle, industry: lead.industry, country: lead.country, website: lead.website },
      verification: verification ? { status: verification.status, score: verification.score } : null,
      websiteScore: websiteAnalysis?.websiteScore ?? null,
      opportunityScore: websiteAnalysis?.opportunityScore ?? null,
      linkedInResearch: researchCacheKey([companyResearch, personResearch]),
    };
    const inputHash = computeInputHash(inputData);

    if (!data.forceRefresh) {
      const existing = await prisma.leadEnrichment.findUnique({ where: { id: enrichmentId } });
      if (existing && existing.inputHash === inputHash && (existing.status === 'COMPLETED' || existing.status === 'PARTIAL')) {
        return { enrichmentId, status: 'COMPLETED_FROM_CACHE' };
      }
    }

    await prisma.leadEnrichment.update({
      where: { id: enrichmentId },
      data: { status: 'ENRICHING', lastAttemptAt: new Date(), inputHash },
    });

    const seniority = inferSeniority(effectiveJobTitle);
    const department = inferDepartment(effectiveJobTitle);

    const icpResult = calculateICPFitScore(
      { industry: lead.industry, country: lead.country, countryCode: lead.countryCode, jobTitle: effectiveJobTitle, company: lead.company, companySize: employeeRange },
      icpProfile ? {
        targetIndustries: icpProfile.targetIndustries as string[],
        targetCountries: icpProfile.targetCountries as string[],
        targetCompanySizes: icpProfile.targetCompanySizes as string[],
        targetJobTitles: icpProfile.targetJobTitles as string[],
        targetSeniorities: icpProfile.targetSeniorities as string[],
        weights: icpProfile.weights as { industry: number; location: number; companySize: number; jobTitle: number; seniority: number },
      } : null,
    );

    const qualityResult = calculateLeadQualityScore(
      { firstName: lead.firstName, lastName: lead.lastName, jobTitle: effectiveJobTitle, phone: lead.phone, linkedinUrl: lead.linkedinUrl ?? personResearch?.normalizedUrl ?? null, company: lead.company, companyDomain: lead.companyDomain, industry: lead.industry },
      verification ? { status: verification.status, score: verification.score } : null,
      !!websiteAnalysis,
    );

    const opportunityScore = websiteAnalysis?.opportunityScore ?? null;
    const prospectResult = calculateProspectScore(icpResult.score, qualityResult.score, opportunityScore, seniority);

    await prisma.leadEnrichment.update({
      where: { id: enrichmentId },
      data: {
        icpFitScore: icpResult.score,
        icpBreakdown: toJson(icpResult.breakdown),
        leadQualityScore: qualityResult.score,
        leadQualityBreakdown: toJson(qualityResult.breakdown),
        prospectScore: prospectResult.score,
        prospectBreakdown: toJson(prospectResult.breakdown),
        prospectPriority: prospectResult.priority,
        seniority,
        department,
      },
    });

    try {
      const aiInput: LeadEnrichmentInput = {
        lead: {
          firstName: lead.firstName, lastName: lead.lastName, email: lead.email,
          company: lead.company, companyDomain: lead.companyDomain, jobTitle: lead.jobTitle,
          industry: lead.industry, country: lead.country, state: lead.state, city: lead.city, website: lead.website,
        },
        verification: verification ? { status: verification.status, score: verification.score, domain: verification.domain, mxStatus: verification.mxStatus } : null,
        websiteIntelligence: websiteAnalysis ? {
          websiteScore: websiteAnalysis.websiteScore,
          opportunityScore: websiteAnalysis.opportunityScore,
          opportunityPriority: websiteAnalysis.opportunityPriority,
          scoreBreakdown: websiteAnalysis.scoreBreakdown as Record<string, number> | null,
          technologies: websiteAnalysis.technologies as { name: string; category?: string }[] | null,
          recommendedServices: websiteAnalysis.recommendedServices as { service: string; evidence: string[]; confidence: string }[] | null,
          aiSummary: websiteAnalysis.aiSummary,
          personalizationHooks: websiteAnalysis.aiPersonalizationHooks as string[] | null,
        } : null,
        icpProfile: icpProfile ? {
          targetIndustries: icpProfile.targetIndustries as string[],
          targetCountries: icpProfile.targetCountries as string[],
          targetCompanySizes: icpProfile.targetCompanySizes as string[],
          targetJobTitles: icpProfile.targetJobTitles as string[],
          targetSeniorities: icpProfile.targetSeniorities as string[],
        } : null,
        serviceCatalog: serviceCatalog.map(s => ({
          name: s.name,
          description: s.description,
          matchingSignals: s.matchingSignals as string[],
        })),
        linkedInResearch: toLinkedInResearchInput(companyResearch, personResearch),
      };

      const aiResult = await aiProvider.enrichLead(aiInput);

      const dynamicVars = buildDynamicVariables(
        lead,
        { aiSummary: aiResult.summary, painPointHypotheses: aiResult.painPointHypotheses, recommendedServices: aiResult.recommendedServices, personalizationHooks: aiResult.personalizationHooks, outreachAngles: aiResult.outreachAngles },
        websiteAnalysis ? { websiteScore: websiteAnalysis.websiteScore, opportunityScore: websiteAnalysis.opportunityScore, aiSummary: websiteAnalysis.aiSummary } : null,
      );

      await prisma.leadEnrichment.update({
        where: { id: enrichmentId },
        data: {
          status: 'COMPLETED',
          aiSummary: aiResult.summary,
          painPointHypotheses: toJson(aiResult.painPointHypotheses),
          recommendedServices: toJson(aiResult.recommendedServices),
          personalizationHooks: toJson(aiResult.personalizationHooks),
          outreachAngles: toJson(aiResult.outreachAngles),
          companyProfile: toJson(aiResult.companyInsights),
          dynamicVariables: toJson(dynamicVars),
          aiConfidence: aiResult.confidence,
          opportunityAssessment: aiResult.opportunityAssessment ? toJson(aiResult.opportunityAssessment) : undefined,
          enrichedAt: new Date(),
        },
      });
      void publishWorkflowEvent({
        eventType: 'LEAD_ENRICHED',
        workspaceId,
        leadId,
        idempotencyKey: `lead-enriched:${enrichmentId}`,
        metadata: { enrichmentId, status: 'COMPLETED' },
      }).catch(() => {});
    } catch (aiError) {
      console.error('AI enrichment failed, saving deterministic results only:', aiError);

      const dynamicVars = buildDynamicVariables(lead, null, websiteAnalysis ? { websiteScore: websiteAnalysis.websiteScore, opportunityScore: websiteAnalysis.opportunityScore, aiSummary: websiteAnalysis.aiSummary } : null);

      await prisma.leadEnrichment.update({
        where: { id: enrichmentId },
        data: {
          status: 'PARTIAL',
          dynamicVariables: toJson(dynamicVars),
          errorMessage: aiError instanceof Error ? aiError.message : String(aiError),
          enrichedAt: new Date(),
        },
      });

      void publishWorkflowEvent({
        eventType: 'LEAD_ENRICHED',
        workspaceId,
        leadId,
        idempotencyKey: `lead-enriched:${enrichmentId}`,
        metadata: { enrichmentId, status: 'PARTIAL' },
      }).catch(() => {});
    }

    return { enrichmentId, status: 'COMPLETED' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.leadEnrichment.update({
      where: { id: enrichmentId },
      data: {
        status: 'FAILED',
        errorMessage,
        lastAttemptAt: new Date(),
        retryCount: { increment: 1 },
      },
    });
    throw error;
  }
}
