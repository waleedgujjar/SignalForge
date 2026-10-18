import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdd = vi.fn().mockResolvedValue({});

vi.mock('@signalforge/database', () => ({
  prisma: {
    leadEnrichment: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: vi.fn(() => ({ REDIS_URL: 'redis://localhost:6379' })),
}));

vi.mock('@signalforge/queue', () => ({
  QUEUE_NAMES: { LEAD_ENRICHMENT: 'lead-enrichment' },
  createRedisConnection: vi.fn(() => ({ url: 'redis://localhost:6379' })),
  createQueue: vi.fn(() => ({ add: mockAdd })),
  DEFAULT_JOB_OPTIONS: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
}));

import { prisma } from '@signalforge/database';
import { enqueueEnrichmentAfterAnalysis } from './enqueue-enrichment.js';

const db = prisma as unknown as {
  leadEnrichment: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.leadEnrichment.findUnique.mockResolvedValue(null);
  db.leadEnrichment.upsert.mockResolvedValue({ id: 'enr-1' });
});

describe('enqueueEnrichmentAfterAnalysis', () => {
  it('1: queues enrichment after website analysis completes', async () => {
    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-1');
    expect(db.leadEnrichment.upsert).toHaveBeenCalledWith({
      where: { leadId: 'lead-1' },
      create: { leadId: 'lead-1', workspaceId: 'ws-1', status: 'QUEUED' },
      update: { status: 'QUEUED', errorMessage: null },
    });
    expect(mockAdd).toHaveBeenCalledWith(
      'enrich-lead',
      expect.objectContaining({
        workspaceId: 'ws-1',
        leadId: 'lead-1',
        enrichmentId: 'enr-1',
      }),
      expect.any(Object),
    );
  });

  it('skips if enrichment already COMPLETED', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue({ id: 'enr-existing', status: 'COMPLETED' });

    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-existing');
    expect(db.leadEnrichment.upsert).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('skips if enrichment already QUEUED', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue({ id: 'enr-queued', status: 'QUEUED' });

    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-queued');
    expect(db.leadEnrichment.upsert).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('skips if enrichment already ENRICHING', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue({ id: 'enr-active', status: 'ENRICHING' });

    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-active');
    expect(db.leadEnrichment.upsert).not.toHaveBeenCalled();
  });

  it('re-queues if enrichment previously FAILED', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue({ id: 'enr-failed', status: 'FAILED' });
    db.leadEnrichment.upsert.mockResolvedValue({ id: 'enr-failed' });

    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-failed');
    expect(db.leadEnrichment.upsert).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledOnce();
  });

  it('creates new enrichment if none exists', async () => {
    db.leadEnrichment.findUnique.mockResolvedValue(null);
    db.leadEnrichment.upsert.mockResolvedValue({ id: 'enr-new' });

    const result = await enqueueEnrichmentAfterAnalysis('ws-1', 'lead-1');

    expect(result).toBe('enr-new');
    expect(db.leadEnrichment.upsert).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledOnce();
  });
});
