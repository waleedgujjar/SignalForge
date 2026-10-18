import { prisma } from '@signalforge/database';
import { analyzeWebsite, type AnalysisResult } from '@signalforge/website-scanner';
import type { AIProvider, WebsiteAIAnalysisInput } from '@signalforge/ai';
import { publishWorkflowEvent } from '@signalforge/automations';
import { enqueueEnrichmentAfterAnalysis } from './enqueue-enrichment.js';

export interface WebsiteAnalysisJobData {
  workspaceId: string;
  leadId: string;
  analysisId: string;
  url: string;
  domain: string;
  forceRescan?: boolean;
  maxPages?: number;
  reanalyze?: boolean;
}

function toJson(value: unknown): ReturnType<typeof JSON.parse> {
  return JSON.parse(JSON.stringify(value));
}

function buildCacheKey(domain: string): string {
  return `${domain}:deterministic-v1`;
}

export async function processWebsiteAnalysisJob(
  data: WebsiteAnalysisJobData,
  aiProvider: AIProvider,
): Promise<{ analysisId: string; status: string }> {
  const { analysisId, url, domain, forceRescan, maxPages, reanalyze } = data;

  try {
    const cacheKey = buildCacheKey(domain);

    if (!forceRescan && !reanalyze) {
      const cached = await prisma.websiteAnalysis.findFirst({
        where: {
          workspaceId: data.workspaceId,
          domain,
          status: 'COMPLETED',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          id: { not: analysisId },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (cached) {
        await prisma.websiteAnalysis.update({
          where: { id: analysisId },
          data: {
            status: 'COMPLETED',
            websiteScore: cached.websiteScore,
            opportunityScore: cached.opportunityScore,
            opportunityPriority: cached.opportunityPriority,
            scoreBreakdown: toJson(cached.scoreBreakdown),
            technicalFindings: toJson(cached.technicalFindings),
            performanceData: toJson(cached.performanceData),
            seoFindings: toJson(cached.seoFindings),
            mobileFindings: toJson(cached.mobileFindings),
            contentFindings: toJson(cached.contentFindings),
            conversionData: toJson(cached.conversionData),
            technologies: toJson(cached.technologies),
            aiSignals: toJson(cached.aiSignals),
            modernityAssessment: toJson(cached.modernityAssessment),
            aiSummary: cached.aiSummary,
            aiKeyIssues: toJson(cached.aiKeyIssues),
            aiOpportunities: toJson(cached.aiOpportunities),
            aiPersonalizationHooks: toJson(cached.aiPersonalizationHooks),
            recommendedServices: toJson(cached.recommendedServices),
            pagesCrawled: cached.pagesCrawled,
            crawlDurationMs: cached.crawlDurationMs,
          },
        });

        void enqueueEnrichmentAfterAnalysis(data.workspaceId, data.leadId).catch(() => {});

        return { analysisId, status: 'COMPLETED_FROM_CACHE' };
      }
    }

    await prisma.websiteAnalysis.update({
      where: { id: analysisId },
      data: { status: 'CRAWLING' },
    });

    const result: AnalysisResult = await analyzeWebsite(url, maxPages ? { maxPages } : undefined);

    await prisma.websiteAnalysis.update({
      where: { id: analysisId },
      data: {
        status: 'ANALYZING',
        websiteScore: result.websiteScore,
        opportunityScore: result.opportunityScore,
        opportunityPriority: result.opportunityPriority,
        scoreBreakdown: toJson(result.scoreBreakdown),
        technicalFindings: toJson(result.technicalFindings),
        performanceData: toJson(result.performanceData),
        seoFindings: toJson(result.seoFindings),
        mobileFindings: toJson(result.mobileFindings),
        contentFindings: toJson(result.contentFindings),
        conversionData: toJson(result.conversionData),
        technologies: toJson(result.technologies),
        aiSignals: toJson(result.aiSignals),
        modernityAssessment: toJson(result.modernityAssessment),
        recommendedServices: toJson(result.recommendedServices),
        pagesCrawled: result.pagesCrawled,
        crawlDurationMs: result.crawlDurationMs,
      },
    });

    try {
      const allFindings = [
        ...result.technicalFindings.findings,
        ...result.performanceData.findings,
        ...result.seoFindings.findings,
        ...result.mobileFindings.findings,
        ...result.contentFindings.findings,
        ...result.conversionData.findings,
      ];

      const keyIssues = allFindings
        .filter(f => f.severity === 'HIGH' || f.severity === 'CRITICAL')
        .map(f => f.title);

      const conversionGaps = result.conversionData.findings.map(f => f.title);

      const aiInput: WebsiteAIAnalysisInput = {
        domain: result.domain,
        websiteScore: result.websiteScore,
        categoryScores: result.scoreBreakdown,
        keyIssues,
        technologies: result.technologies.map(t => t.name),
        conversionGaps,
        modernityScore: result.modernityAssessment.modernityScore,
      };

      const aiResult = await aiProvider.analyzeWebsite(aiInput);

      await prisma.websiteAnalysis.update({
        where: { id: analysisId },
        data: {
          status: 'COMPLETED',
          aiSummary: aiResult.summary,
          aiKeyIssues: toJson(aiResult.keyIssues),
          aiOpportunities: toJson(aiResult.opportunities),
          aiPersonalizationHooks: toJson(aiResult.personalizationHooks),
        },
      });
    } catch (aiError) {
      console.error('AI analysis failed, saving deterministic results only:', aiError);
      await prisma.websiteAnalysis.update({
        where: { id: analysisId },
        data: { status: 'COMPLETED' },
      });
    }

    void publishWorkflowEvent({
      eventType: 'WEBSITE_ANALYSIS_COMPLETED',
      workspaceId: data.workspaceId,
      leadId: data.leadId,
      idempotencyKey: `website-analysis:${analysisId}`,
      metadata: { analysisId, url, domain, cacheKey },
    }).catch(() => {});

    void publishWorkflowEvent({
      eventType: 'WEBSITE_ANALYZED',
      workspaceId: data.workspaceId,
      leadId: data.leadId,
      idempotencyKey: `website-analyzed:${analysisId}`,
      metadata: { analysisId, url, domain },
    }).catch(() => {});

    void enqueueEnrichmentAfterAnalysis(data.workspaceId, data.leadId).catch(() => {});

    return { analysisId, status: 'COMPLETED' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.websiteAnalysis.update({
      where: { id: analysisId },
      data: { status: 'FAILED', errorMessage },
    });
    throw error;
  }
}
