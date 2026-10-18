import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/campaigns', () => ({
  campaignLeadService: {
    enrollLeads: vi.fn(),
  },
}));

import { campaignLeadService } from '@signalforge/campaigns';
import { processCampaignEnrollment, type EnrollmentResult } from './processor.js';
import type { CampaignEnrollmentQueuePayload } from '@signalforge/queue';

const enrollLeadsMock = campaignLeadService.enrollLeads as ReturnType<typeof vi.fn>;

function makePayload(overrides?: Partial<CampaignEnrollmentQueuePayload>): CampaignEnrollmentQueuePayload {
  return {
    workspaceId: 'ws-1',
    campaignId: 'camp-1',
    leadIds: ['lead-1', 'lead-2', 'lead-3'],
    actorUserId: 'user-1',
    force: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enrollLeadsMock.mockResolvedValue({ enrolled: 3, skipped: 0 });
});

describe('processCampaignEnrollment', () => {
  // --- Successful enrollment ---

  it('enrolls leads and returns success result', async () => {
    enrollLeadsMock.mockResolvedValue({ enrolled: 3, skipped: 0 });

    const result = await processCampaignEnrollment(makePayload());

    expect(result).toEqual<EnrollmentResult>({
      ok: true,
      enrolled: 3,
      skipped: 0,
      chunks: 1,
    });
  });

  it('passes campaignId, workspaceId, leadIds, and options to enrollLeads', async () => {
    await processCampaignEnrollment(makePayload({
      campaignId: 'camp-42',
      workspaceId: 'ws-99',
      leadIds: ['lead-a'],
      actorUserId: 'user-7',
      force: true,
    }));

    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-42',
      'ws-99',
      ['lead-a'],
      { actorUserId: 'user-7', force: true },
    );
  });

  // --- Empty leads ---

  it('returns immediately with zero counts when leadIds is empty', async () => {
    const result = await processCampaignEnrollment(makePayload({ leadIds: [] }));

    expect(result).toEqual<EnrollmentResult>({
      ok: true,
      enrolled: 0,
      skipped: 0,
      chunks: 0,
    });
    expect(enrollLeadsMock).not.toHaveBeenCalled();
  });

  // --- Chunking ---

  it('processes leads in chunks of 100', async () => {
    const leadIds = Array.from({ length: 250 }, (_, i) => `lead-${i}`);
    enrollLeadsMock
      .mockResolvedValueOnce({ enrolled: 100, skipped: 0 })
      .mockResolvedValueOnce({ enrolled: 100, skipped: 0 })
      .mockResolvedValueOnce({ enrolled: 50, skipped: 0 });

    const result = await processCampaignEnrollment(makePayload({ leadIds }));

    expect(enrollLeadsMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual<EnrollmentResult>({
      ok: true,
      enrolled: 250,
      skipped: 0,
      chunks: 3,
    });
  });

  it('sends the correct lead slice to each chunk', async () => {
    const leadIds = Array.from({ length: 150 }, (_, i) => `lead-${i}`);
    enrollLeadsMock.mockResolvedValue({ enrolled: 50, skipped: 0 });

    await processCampaignEnrollment(makePayload({ leadIds }));

    const firstChunk = enrollLeadsMock.mock.calls[0]![2] as string[];
    const secondChunk = enrollLeadsMock.mock.calls[1]![2] as string[];

    expect(firstChunk).toHaveLength(100);
    expect(firstChunk[0]).toBe('lead-0');
    expect(firstChunk[99]).toBe('lead-99');

    expect(secondChunk).toHaveLength(50);
    expect(secondChunk[0]).toBe('lead-100');
    expect(secondChunk[49]).toBe('lead-149');
  });

  it('handles exactly 100 leads as a single chunk', async () => {
    const leadIds = Array.from({ length: 100 }, (_, i) => `lead-${i}`);
    enrollLeadsMock.mockResolvedValue({ enrolled: 100, skipped: 0 });

    const result = await processCampaignEnrollment(makePayload({ leadIds }));

    expect(enrollLeadsMock).toHaveBeenCalledTimes(1);
    expect(result.chunks).toBe(1);
    expect(result.enrolled).toBe(100);
  });

  // --- Skipped leads (already enrolled, ineligible) ---

  it('accumulates skipped counts across chunks', async () => {
    const leadIds = Array.from({ length: 200 }, (_, i) => `lead-${i}`);
    enrollLeadsMock
      .mockResolvedValueOnce({ enrolled: 80, skipped: 20 })
      .mockResolvedValueOnce({ enrolled: 70, skipped: 30 });

    const result = await processCampaignEnrollment(makePayload({ leadIds }));

    expect(result).toEqual<EnrollmentResult>({
      ok: true,
      enrolled: 150,
      skipped: 50,
      chunks: 2,
    });
  });

  it('reports all leads as skipped when none are eligible', async () => {
    enrollLeadsMock.mockResolvedValue({ enrolled: 0, skipped: 3 });

    const result = await processCampaignEnrollment(makePayload());

    expect(result.ok).toBe(true);
    expect(result.enrolled).toBe(0);
    expect(result.skipped).toBe(3);
  });

  // --- Blocked campaign ---

  it('stops processing and returns blocked when enrollment is blocked', async () => {
    enrollLeadsMock.mockResolvedValue({
      enrolled: 0,
      skipped: 3,
      blocked: 'CAMPAIGN_COMPLETED',
    });

    const result = await processCampaignEnrollment(makePayload());

    expect(result).toEqual<EnrollmentResult>({
      ok: false,
      enrolled: 0,
      skipped: 3,
      chunks: 0,
      blocked: 'CAMPAIGN_COMPLETED',
    });
  });

  it('stops at the first blocked chunk and includes partial counts', async () => {
    const leadIds = Array.from({ length: 250 }, (_, i) => `lead-${i}`);
    enrollLeadsMock
      .mockResolvedValueOnce({ enrolled: 95, skipped: 5 })
      .mockResolvedValueOnce({
        enrolled: 0,
        skipped: 100,
        blocked: 'CAMPAIGN_ARCHIVED',
      });

    const result = await processCampaignEnrollment(makePayload({ leadIds }));

    expect(enrollLeadsMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual<EnrollmentResult>({
      ok: false,
      enrolled: 95,
      skipped: 105,
      chunks: 1,
      blocked: 'CAMPAIGN_ARCHIVED',
    });
  });

  it('does not process remaining chunks after a block', async () => {
    const leadIds = Array.from({ length: 300 }, (_, i) => `lead-${i}`);
    enrollLeadsMock
      .mockResolvedValueOnce({
        enrolled: 0,
        skipped: 100,
        blocked: 'CAMPAIGN_COMPLETED',
      });

    await processCampaignEnrollment(makePayload({ leadIds }));

    expect(enrollLeadsMock).toHaveBeenCalledTimes(1);
  });

  // --- Workspace isolation ---

  it('passes the correct workspaceId through to enrollLeads', async () => {
    await processCampaignEnrollment(makePayload({ workspaceId: 'ws-isolated' }));

    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-1',
      'ws-isolated',
      expect.any(Array),
      expect.objectContaining({}),
    );
  });

  // --- Force option ---

  it('passes force=true through to enrollLeads options', async () => {
    await processCampaignEnrollment(makePayload({ force: true }));

    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-1',
      'ws-1',
      expect.any(Array),
      expect.objectContaining({ force: true }),
    );
  });

  it('passes force=false through to enrollLeads options', async () => {
    await processCampaignEnrollment(makePayload({ force: false }));

    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-1',
      'ws-1',
      expect.any(Array),
      expect.objectContaining({ force: false }),
    );
  });

  // --- Error handling ---

  it('propagates errors thrown by enrollLeads', async () => {
    enrollLeadsMock.mockRejectedValue(new Error('Campaign not found'));

    await expect(processCampaignEnrollment(makePayload())).rejects.toThrow(
      'Campaign not found',
    );
  });

  it('propagates errors from a mid-chunk failure', async () => {
    const leadIds = Array.from({ length: 200 }, (_, i) => `lead-${i}`);
    enrollLeadsMock
      .mockResolvedValueOnce({ enrolled: 100, skipped: 0 })
      .mockRejectedValueOnce(new Error('Database connection lost'));

    await expect(
      processCampaignEnrollment(makePayload({ leadIds })),
    ).rejects.toThrow('Database connection lost');

    expect(enrollLeadsMock).toHaveBeenCalledTimes(2);
  });

  // --- Single lead ---

  it('handles a single lead', async () => {
    enrollLeadsMock.mockResolvedValue({ enrolled: 1, skipped: 0 });

    const result = await processCampaignEnrollment(
      makePayload({ leadIds: ['lead-only'] }),
    );

    expect(result).toEqual<EnrollmentResult>({
      ok: true,
      enrolled: 1,
      skipped: 0,
      chunks: 1,
    });
  });

  // --- Optional fields ---

  it('works without actorUserId', async () => {
    enrollLeadsMock.mockResolvedValue({ enrolled: 1, skipped: 0 });

    const result = await processCampaignEnrollment(
      makePayload({ actorUserId: undefined, leadIds: ['lead-1'] }),
    );

    expect(result.ok).toBe(true);
    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-1',
      'ws-1',
      ['lead-1'],
      { actorUserId: undefined, force: false },
    );
  });

  it('works without force flag', async () => {
    enrollLeadsMock.mockResolvedValue({ enrolled: 1, skipped: 0 });

    const result = await processCampaignEnrollment(
      makePayload({ force: undefined, leadIds: ['lead-1'] }),
    );

    expect(result.ok).toBe(true);
    expect(enrollLeadsMock).toHaveBeenCalledWith(
      'camp-1',
      'ws-1',
      ['lead-1'],
      { actorUserId: 'user-1', force: undefined },
    );
  });
});
