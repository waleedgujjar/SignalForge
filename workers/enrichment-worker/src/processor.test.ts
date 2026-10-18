import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    leadEnrichment: { findUnique: vi.fn(), update: vi.fn() },
    leadResearch: { findMany: vi.fn() },
    iCPProfile: { findUnique: vi.fn() },
    serviceCatalogEntry: { findMany: vi.fn() },
  },
}));

vi.mock('@signalforge/ai', () => ({
  inferSeniority: vi.fn(() => 'MANAGER'),
  inferDepartment: vi.fn(() => 'OPERATIONS'),
  calculateICPFitScore: vi.fn(() => ({ score: 72, breakdown: { industry: 20, location: 10, companySize: 12, jobTitle: 18, seniority: 12 } })),
  calculateLeadQualityScore: vi.fn(() => ({ score: 68, breakdown: { completeness: 25, verification: 20, digital: 13, engagement: 10 } })),
  calculateProspectScore: vi.fn(() => ({ score: 75, breakdown: { icpFit: 30, leadQuality: 20, opportunity: 15, seniority: 10 }, priority: 'HIGH' })),
  buildDynamicVariables: vi.fn(() => ({ firstName: 'John', company: 'ACME' })),
}));

vi.mock('@signalforge/queue', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue('evt-1'),
}));

import { prisma } from '@signalforge/database';
import {
  inferSeniority,
  inferDepartment,
  calculateICPFitScore,
  calculateLeadQualityScore,
  calculateProspectScore,
} from '@signalforge/ai';
import { publishWorkflowEvent } from '@signalforge/queue';
import { processEnrichmentJob, type EnrichmentJobData } from './processor.js';

const db = prisma as unknown as {
  lead: { findUnique: ReturnType<typeof vi.fn> };
  leadEnrichment: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  leadResearch: { findMany: ReturnType<typeof vi.fn> };
  iCPProfile: { findUnique: ReturnType<typeof vi.fn> };
  serviceCatalogEntry: { findMany: ReturnType<typeof vi.fn> };
};

const mockPublish = publishWorkflowEvent as ReturnType<typeof vi.fn>;

const MOCK_AI_RESULT = {
  summary: 'ACME Corp is a mid-market HVAC company in Houston.',
  painPointHypotheses: [{ observation: 'Outdated website', hypothesis: 'Losing leads to competitors', confidence: 'HIGH', source: 'OBSERVED' }],
  recommendedServices: [{ service: 'Website Redesign', score: 85, confidence: 'HIGH', evidence: ['Low website score'] }],
  personalizationHooks: [{ observation: 'HVAC industry', angle: 'Seasonal demand patterns', confidence: 'MEDIUM' }],
  outreachAngles: [{ angle: 'Website modernization', reasoning: 'Low website score', evidence: ['Score: 45'], confidence: 'HIGH' }],
  companyInsights: { description: 'HVAC services provider', businessType: 'B2C' },
  confidence: 'HIGH' as const,
  opportunityAssessment: {
    icpFit: { value: 'HIGH', status: 'INFERRED', evidence: ['Industry match'] },
    serviceFit: { value: 'HIGH', status: 'INFERRED', evidence: ['Website needs work'] },
    aiReceptionistOpportunity: { value: null, status: 'UNKNOWN', evidence: [] },
    customerResponseOpportunity: { value: null, status: 'UNKNOWN', evidence: [] },
    appointmentBookingOpportunity: { value: null, status: 'UNKNOWN', evidence: [] },
    websiteOpportunity: { value: 'HIGH', status: 'INFERRED', evidence: ['Low score'] },
    leadQuality: { value: 'MEDIUM', status: 'INFERRED', evidence: ['Verified email'] },
  },
};

const mockAiProvider = {
  enrichLead: vi.fn().mockResolvedValue(MOCK_AI_RESULT),
  analyzeWebsite: vi.fn(),
  chat: vi.fn(),
  generateEmail: vi.fn(),
  classifyReply: vi.fn(),
  suggestReply: vi.fn(),
  researchCompany: vi.fn(),
  scoreLead: vi.fn(),
  personalizeEmail: vi.fn(),
  analyzeDeliverability: vi.fn(),
  analyzeAnalytics: vi.fn(),
};

const BASE_LEAD = {
  id: 'lead-1',
  workspaceId: 'ws-1',
  email: 'john@acme.com',
  firstName: 'John',
  lastName: 'Doe',
  fullName: 'John Doe',
  company: 'ACME Corp',
  companyDomain: 'acme.com',
  jobTitle: 'Operations Manager',
  industry: 'HVAC',
  country: 'United States',
  countryCode: 'US',
  state: 'TX',
  city: 'Houston',
  website: 'https://acme.com',
  phone: '+1-555-0100',
  linkedinUrl: null,
  verification: {
    status: 'VALID',
    score: 95,
    domain: 'acme.com',
    mxStatus: 'VALID',
  },
  websiteAnalyses: [{
    id: 'wa-1',
    status: 'COMPLETED',
    websiteScore: 45,
    opportunityScore: 78,
    opportunityPriority: 'HIGH',
    scoreBreakdown: { technical: 50, performance: 40, seo: 45 },
    technologies: [{ name: 'WordPress', category: 'CMS' }],
    recommendedServices: [{ service: 'Website Redesign', evidence: ['Low score'], confidence: 'HIGH' }],
    aiSummary: 'Outdated HVAC website.',
    aiPersonalizationHooks: ['HVAC seasonal patterns'],
  }],
};

const JOB_DATA: EnrichmentJobData = {
  workspaceId: 'ws-1',
  leadId: 'lead-1',
  enrichmentId: 'enr-1',
};

function mockIcpProfile() {
  return {
    workspaceId: 'ws-1',
    targetIndustries: ['HVAC'],
    targetCountries: ['United States'],
    targetCompanySizes: ['11-50'],
    targetJobTitles: ['Manager'],
    targetSeniorities: ['MANAGER'],
    weights: { industry: 25, location: 15, companySize: 15, jobTitle: 25, seniority: 20 },
  };
}

function mockServiceCatalog() {
  return [
    { name: 'Website Redesign', description: 'Full redesign', matchingSignals: ['low website score'], enabled: true, sortOrder: 0 },
    { name: 'SEO Optimization', description: 'SEO services', matchingSignals: ['poor seo'], enabled: true, sortOrder: 1 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.lead.findUnique.mockResolvedValue(BASE_LEAD);
  db.leadEnrichment.findUnique.mockResolvedValue({ id: 'enr-1', status: 'QUEUED', inputHash: null });
  db.leadEnrichment.update.mockResolvedValue({});
  db.leadResearch.findMany.mockResolvedValue([]);
  db.iCPProfile.findUnique.mockResolvedValue(mockIcpProfile());
  db.serviceCatalogEntry.findMany.mockResolvedValue(mockServiceCatalog());
  mockAiProvider.enrichLead.mockResolvedValue(MOCK_AI_RESULT);
  mockPublish.mockResolvedValue('evt-1');
});

describe('processEnrichmentJob', () => {
  it('2: AI uses existing website intelligence data, no re-crawl', async () => {
    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(mockAiProvider.enrichLead).toHaveBeenCalledOnce();
    const callArg = mockAiProvider.enrichLead.mock.calls[0]![0];
    expect(callArg.websiteIntelligence).toEqual(expect.objectContaining({
      websiteScore: 45,
      opportunityScore: 78,
      opportunityPriority: 'HIGH',
      aiSummary: 'Outdated HVAC website.',
    }));
  });

  it('3: AI provider called with correct structured input', async () => {
    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(mockAiProvider.enrichLead).toHaveBeenCalledOnce();
    const callArg = mockAiProvider.enrichLead.mock.calls[0]![0];
    expect(callArg).toHaveProperty('lead');
    expect(callArg).toHaveProperty('verification');
    expect(callArg).toHaveProperty('websiteIntelligence');
    expect(callArg).toHaveProperty('icpProfile');
    expect(callArg).toHaveProperty('serviceCatalog');
    expect(callArg.lead.email).toBe('john@acme.com');
    expect(callArg.verification.status).toBe('VALID');
    expect(callArg.icpProfile.targetIndustries).toEqual(['HVAC']);
    expect(callArg.serviceCatalog).toHaveLength(2);
    expect(callArg.serviceCatalog[0]!.name).toBe('Website Redesign');
  });

  it('4: deterministic scoring computed and saved correctly', async () => {
    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(inferSeniority).toHaveBeenCalledWith('Operations Manager');
    expect(inferDepartment).toHaveBeenCalledWith('Operations Manager');
    expect(calculateICPFitScore).toHaveBeenCalledOnce();
    expect(calculateLeadQualityScore).toHaveBeenCalledOnce();
    expect(calculateProspectScore).toHaveBeenCalledOnce();

    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'enr-1' },
      data: expect.objectContaining({
        icpFitScore: 72,
        leadQualityScore: 68,
        prospectScore: 75,
        prospectPriority: 'HIGH',
        seniority: 'MANAGER',
        department: 'OPERATIONS',
      }),
    }));
  });

  it('5: AI failure results in PARTIAL status with deterministic results preserved', async () => {
    mockAiProvider.enrichLead.mockRejectedValue(new Error('AI provider unavailable'));

    const result = await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(result).toEqual({ enrichmentId: 'enr-1', status: 'COMPLETED' });

    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'enr-1' },
      data: expect.objectContaining({
        icpFitScore: 72,
        prospectScore: 75,
        seniority: 'MANAGER',
      }),
    }));

    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'enr-1' },
      data: expect.objectContaining({
        status: 'PARTIAL',
        errorMessage: 'AI provider unavailable',
      }),
    }));
  });

  it('6: input hash prevents duplicate AI calls', async () => {
    // First call to compute the actual hash for the test data
    const firstResult = await processEnrichmentJob(JOB_DATA, mockAiProvider as never);
    expect(firstResult.status).toBe('COMPLETED');

    // Extract the inputHash that was written in the ENRICHING update
    const enrichingCall = db.leadEnrichment.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === 'ENRICHING',
    );
    const actualHash = (enrichingCall![0] as { data: { inputHash: string } }).data.inputHash;

    vi.clearAllMocks();
    db.lead.findUnique.mockResolvedValue(BASE_LEAD);
    db.leadResearch.findMany.mockResolvedValue([]);
    db.iCPProfile.findUnique.mockResolvedValue(mockIcpProfile());
    db.serviceCatalogEntry.findMany.mockResolvedValue(mockServiceCatalog());

    // Now simulate a second call where existing enrichment has the same hash
    db.leadEnrichment.findUnique.mockResolvedValue({
      id: 'enr-1',
      status: 'COMPLETED',
      inputHash: actualHash,
    });

    const result = await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(result.status).toBe('COMPLETED_FROM_CACHE');
    expect(mockAiProvider.enrichLead).not.toHaveBeenCalled();
  });

  it('7: force refresh bypasses input hash cache', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue({
      id: 'enr-1',
      status: 'COMPLETED',
      inputHash: 'matching-hash',
    });

    const result = await processEnrichmentJob(
      { ...JOB_DATA, forceRefresh: true },
      mockAiProvider as never,
    );

    expect(result.status).toBe('COMPLETED');
    expect(mockAiProvider.enrichLead).toHaveBeenCalledOnce();
  });

  it('8: workspace mismatch results in FAILED status', async () => {
    db.lead.findUnique.mockResolvedValue({ ...BASE_LEAD, workspaceId: 'ws-other' });

    const result = await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(result).toEqual({ enrichmentId: 'enr-1', status: 'FAILED' });
    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Lead not found or workspace mismatch',
      }),
    }));
    expect(mockAiProvider.enrichLead).not.toHaveBeenCalled();
  });

  it('9: missing lead results in FAILED status', async () => {
    db.lead.findUnique.mockResolvedValue(null);

    const result = await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(result).toEqual({ enrichmentId: 'enr-1', status: 'FAILED' });
    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Lead not found or workspace mismatch',
      }),
    }));
  });

  it('10: full enrichment persists all AI fields', async () => {
    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(db.leadEnrichment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'enr-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        aiSummary: 'ACME Corp is a mid-market HVAC company in Houston.',
        aiConfidence: 'HIGH',
        enrichedAt: expect.any(Date),
      }),
    }));

    const completedCall = db.leadEnrichment.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === 'COMPLETED',
    );
    expect(completedCall).toBeDefined();
    const data = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('painPointHypotheses');
    expect(data).toHaveProperty('recommendedServices');
    expect(data).toHaveProperty('personalizationHooks');
    expect(data).toHaveProperty('outreachAngles');
    expect(data).toHaveProperty('companyProfile');
    expect(data).toHaveProperty('dynamicVariables');
    expect(data).toHaveProperty('opportunityAssessment');
  });

  it('11: LEAD_ENRICHED workflow event published after completion', async () => {
    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'LEAD_ENRICHED',
      workspaceId: 'ws-1',
      leadId: 'lead-1',
      idempotencyKey: 'lead-enriched:enr-1',
      metadata: expect.objectContaining({ enrichmentId: 'enr-1', status: 'COMPLETED' }),
    }));
  });

  it('11b: LEAD_ENRICHED event published with PARTIAL status on AI failure', async () => {
    mockAiProvider.enrichLead.mockRejectedValue(new Error('AI unavailable'));

    await processEnrichmentJob(JOB_DATA, mockAiProvider as never);

    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'LEAD_ENRICHED',
      workspaceId: 'ws-1',
      leadId: 'lead-1',
      metadata: expect.objectContaining({ status: 'PARTIAL' }),
    }));
  });
});
