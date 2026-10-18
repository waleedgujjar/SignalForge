import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    websiteAnalysis: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@signalforge/website-scanner', () => ({
  analyzeWebsite: vi.fn(),
}));

vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@signalforge/database';
import { analyzeWebsite } from '@signalforge/website-scanner';
import {
  processWebsiteAnalysisJob,
  type WebsiteAnalysisJobData,
} from './processor.js';

const db = prisma as unknown as {
  websiteAnalysis: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockAnalyze = analyzeWebsite as ReturnType<typeof vi.fn>;

const JOB_DATA: WebsiteAnalysisJobData = {
  workspaceId: 'ws-1',
  leadId: 'lead-1',
  analysisId: 'wa-1',
  url: 'https://example.com',
  domain: 'example.com',
};

const MOCK_RESULT = {
  domain: 'example.com',
  websiteScore: 72,
  opportunityScore: 65,
  opportunityPriority: 'MEDIUM',
  scoreBreakdown: { technical: 80, performance: 70, seo: 65 },
  technicalFindings: { findings: [] },
  performanceData: { findings: [] },
  seoFindings: { findings: [] },
  mobileFindings: { findings: [] },
  contentFindings: { findings: [] },
  conversionData: { findings: [] },
  technologies: [{ name: 'WordPress' }],
  aiSignals: {},
  modernityAssessment: { modernityScore: 60 },
  recommendedServices: [],
  pagesCrawled: 5,
  crawlDurationMs: 3200,
};

const mockAiProvider = {
  analyzeWebsite: vi.fn().mockResolvedValue({
    summary: 'Test summary',
    keyIssues: [],
    opportunities: [],
    personalizationHooks: [],
  }),
  generateEmail: vi.fn(),
  chat: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.websiteAnalysis.findFirst.mockResolvedValue(null);
  db.websiteAnalysis.update.mockResolvedValue({});
  mockAnalyze.mockResolvedValue(MOCK_RESULT);
});

describe('processWebsiteAnalysisJob', () => {
  it('4: processes analysis job with correct status transitions', async () => {
    const result = await processWebsiteAnalysisJob(
      JOB_DATA,
      mockAiProvider as never,
    );

    expect(result).toEqual({ analysisId: 'wa-1', status: 'COMPLETED' });

    expect(db.websiteAnalysis.update).toHaveBeenCalledTimes(3);

    // First update: CRAWLING
    expect(db.websiteAnalysis.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'wa-1' },
      data: { status: 'CRAWLING' },
    });

    // Second update: ANALYZING with scores
    expect(db.websiteAnalysis.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'wa-1' },
        data: expect.objectContaining({
          status: 'ANALYZING',
          websiteScore: 72,
          opportunityScore: 65,
          pagesCrawled: 5,
        }),
      }),
    );

    // Third update: COMPLETED with AI results
    expect(db.websiteAnalysis.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { id: 'wa-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('uses cached result when a recent COMPLETED analysis exists for the domain', async () => {
    db.websiteAnalysis.findFirst.mockResolvedValue({
      id: 'cached-wa',
      websiteScore: 80,
      opportunityScore: 70,
      opportunityPriority: 'HIGH',
      scoreBreakdown: JSON.stringify({ technical: 85 }),
      technicalFindings: JSON.stringify({ findings: [] }),
      performanceData: JSON.stringify({ findings: [] }),
      seoFindings: JSON.stringify({ findings: [] }),
      mobileFindings: JSON.stringify({ findings: [] }),
      contentFindings: JSON.stringify({ findings: [] }),
      conversionData: JSON.stringify({ findings: [] }),
      technologies: JSON.stringify([]),
      aiSignals: JSON.stringify({}),
      modernityAssessment: JSON.stringify({ modernityScore: 75 }),
      aiSummary: 'Cached summary',
      aiKeyIssues: JSON.stringify([]),
      aiOpportunities: JSON.stringify([]),
      aiPersonalizationHooks: JSON.stringify([]),
      recommendedServices: JSON.stringify([]),
      pagesCrawled: 3,
      crawlDurationMs: 2000,
    });

    const result = await processWebsiteAnalysisJob(
      JOB_DATA,
      mockAiProvider as never,
    );

    expect(result).toEqual({
      analysisId: 'wa-1',
      status: 'COMPLETED_FROM_CACHE',
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('sets FAILED status and rethrows on error', async () => {
    mockAnalyze.mockRejectedValue(new Error('Crawl timeout'));

    await expect(
      processWebsiteAnalysisJob(JOB_DATA, mockAiProvider as never),
    ).rejects.toThrow('Crawl timeout');

    expect(db.websiteAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'wa-1' },
      data: { status: 'FAILED', errorMessage: 'Crawl timeout' },
    });
  });

  it('completes with deterministic results when AI enrichment fails', async () => {
    mockAiProvider.analyzeWebsite.mockRejectedValue(
      new Error('AI provider unavailable'),
    );

    const result = await processWebsiteAnalysisJob(
      JOB_DATA,
      mockAiProvider as never,
    );

    expect(result).toEqual({ analysisId: 'wa-1', status: 'COMPLETED' });

    // Should still reach COMPLETED even without AI enrichment
    expect(db.websiteAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'wa-1' },
      data: { status: 'COMPLETED' },
    });
  });
});
