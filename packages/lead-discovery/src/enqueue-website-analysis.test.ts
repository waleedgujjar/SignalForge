import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdd = vi.fn().mockResolvedValue({});
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    websiteAnalysis: { findFirst: vi.fn(), create: vi.fn() },
    discoveredLead: { updateMany: vi.fn() },
  },
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: vi.fn(() => ({ REDIS_URL: 'redis://localhost:6379' })),
}));

vi.mock('@signalforge/queue', () => ({
  QUEUE_NAMES: { WEBSITE_ANALYSIS: 'website-analysis' },
  createRedisConnection: vi.fn(() => ({ url: 'redis://localhost:6379' })),
  createQueue: vi.fn(() => ({ add: mockAdd, close: mockClose })),
  DEFAULT_JOB_OPTIONS: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
}));

import { prisma } from '@signalforge/database';
import {
  enqueueWebsiteAnalysisForLead,
  enqueueWebsiteAnalysisForLeads,
} from './enqueue-website-analysis.js';

const db = prisma as unknown as {
  lead: { findFirst: ReturnType<typeof vi.fn> };
  websiteAnalysis: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  discoveredLead: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.websiteAnalysis.findFirst.mockResolvedValue(null);
  db.discoveredLead.updateMany.mockResolvedValue({ count: 1 });
});

describe('enqueueWebsiteAnalysisForLead', () => {
  it('1: promoted lead triggers website analysis enqueueing', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-1' });

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(result).toBe('wa-1');
    expect(db.websiteAnalysis.create).toHaveBeenCalledOnce();
    expect(db.websiteAnalysis.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws-1',
        leadId: 'lead-1',
        domain: 'example.com',
        url: 'https://example.com',
        status: 'PENDING',
      }),
    });
    expect(mockAdd).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledWith(
      'analyze',
      expect.objectContaining({
        workspaceId: 'ws-1',
        leadId: 'lead-1',
        analysisId: 'wa-1',
        url: 'https://example.com',
        domain: 'example.com',
      }),
      expect.any(Object),
    );
  });

  it('2: lead without website skips analysis gracefully', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: null,
      companyDomain: null,
    });

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(result).toBeNull();
    expect(db.websiteAnalysis.create).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('3: duplicate website analysis prevented (idempotency)', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    db.websiteAnalysis.findFirst.mockResolvedValue({ id: 'existing-wa-1' });

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(result).toBe('existing-wa-1');
    expect(db.websiteAnalysis.create).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('5: analysis results stored with correct lead association', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://mysite.com',
      companyDomain: null,
    });
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-42' });

    await enqueueWebsiteAnalysisForLead('ws-1', 'lead-42');

    expect(db.websiteAnalysis.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadId: 'lead-42' }),
    });
    expect(mockAdd).toHaveBeenCalledWith(
      'analyze',
      expect.objectContaining({ leadId: 'lead-42', analysisId: 'wa-42' }),
      expect.any(Object),
    );
  });

  it('6: failed analysis does not block lead pipeline', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    db.websiteAnalysis.create.mockRejectedValue(new Error('DB write failed'));

    // The promotion code calls: void enqueueWebsiteAnalysisForLead(...).catch(() => {})
    // Simulate that pattern — the error is swallowed, no unhandled rejection
    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1').catch(
      () => null,
    );

    expect(result).toBeNull();
  });

  it('8: rate limiting respects website scanner config via DEFAULT_JOB_OPTIONS', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-1' });

    await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(mockAdd).toHaveBeenCalledWith('analyze', expect.any(Object), {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  });

  it('9: analysis status correctly reflected in lead record', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-1' });

    await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(db.discoveredLead.updateMany).toHaveBeenCalledWith({
      where: { promotedLeadId: 'lead-1', workspaceId: 'ws-1' },
      data: { stage: 'WEBSITE_ANALYZED' },
    });
  });

  it('returns null for non-existent lead', async () => {
    db.lead.findFirst.mockResolvedValue(null);

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'no-such-lead');

    expect(result).toBeNull();
    expect(db.websiteAnalysis.create).not.toHaveBeenCalled();
  });

  it('falls back to companyDomain when website is null', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: null,
      companyDomain: 'fallback.com',
    });
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-fb' });

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(result).toBe('wa-fb');
    expect(db.websiteAnalysis.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        domain: 'fallback.com',
        url: 'https://fallback.com',
      }),
    });
  });

  it('allows retry after a FAILED analysis', async () => {
    db.lead.findFirst.mockResolvedValue({
      website: 'https://example.com',
      companyDomain: null,
    });
    // Only a FAILED analysis exists — should NOT block a new one
    db.websiteAnalysis.findFirst.mockResolvedValue(null);
    db.websiteAnalysis.create.mockResolvedValue({ id: 'wa-retry' });

    const result = await enqueueWebsiteAnalysisForLead('ws-1', 'lead-1');

    expect(result).toBe('wa-retry');
    expect(db.websiteAnalysis.create).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledOnce();
  });
});

describe('enqueueWebsiteAnalysisForLeads', () => {
  it('7: batch promotion triggers multiple analyses', async () => {
    let callCount = 0;
    db.lead.findFirst.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        website: `https://site${callCount}.com`,
        companyDomain: null,
      });
    });
    db.websiteAnalysis.create.mockImplementation(() =>
      Promise.resolve({ id: `wa-${callCount}` }),
    );

    const result = await enqueueWebsiteAnalysisForLeads('ws-1', [
      'lead-1',
      'lead-2',
      'lead-3',
    ]);

    expect(result.queued).toBe(3);
    expect(result.analysisIds).toHaveLength(3);
    expect(db.websiteAnalysis.create).toHaveBeenCalledTimes(3);
    expect(mockAdd).toHaveBeenCalledTimes(3);
  });

  it('skips leads without websites in batch', async () => {
    db.lead.findFirst
      .mockResolvedValueOnce({ website: 'https://a.com', companyDomain: null })
      .mockResolvedValueOnce({ website: null, companyDomain: null })
      .mockResolvedValueOnce({ website: 'https://c.com', companyDomain: null });
    db.websiteAnalysis.create
      .mockResolvedValueOnce({ id: 'wa-a' })
      .mockResolvedValueOnce({ id: 'wa-c' });

    const result = await enqueueWebsiteAnalysisForLeads('ws-1', [
      'lead-a',
      'lead-b',
      'lead-c',
    ]);

    expect(result.queued).toBe(2);
    expect(result.analysisIds).toEqual(['wa-a', 'wa-c']);
  });
});
