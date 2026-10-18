import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeCampaign } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow G: Sending Pipeline', () => {
  describe('sending stats', () => {
    it('returns sending stats for a campaign', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Stats Camp', status: 'ACTIVE' });

      const { sendingJobService } = await import('@signalforge/sending');
      (sendingJobService.getCampaignSendingStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        total: 10,
        sent: 5,
        pending: 3,
        failed: 2,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${camp.id}/sending-stats`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(10);
    });
  });

  describe('campaign bootstrap', () => {
    it('bootstraps sending jobs on campaign launch', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Bootstrap Camp', status: 'DRAFT' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.launch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        campaign: { id: camp.id, status: 'ACTIVE' },
      });

      const { sendingJobService } = await import('@signalforge/sending');

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/launch`,
        payload: {},
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(sendingJobService.bootstrapCampaign).toHaveBeenCalled();
    });

    it('pauses sending jobs when campaign is paused', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Pause Camp', status: 'ACTIVE' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.pause as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: camp.id,
        status: 'PAUSED',
      });

      const { sendingJobService } = await import('@signalforge/sending');

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/pause`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(sendingJobService.pauseCampaignJobs).toHaveBeenCalled();
    });

    it('resumes sending jobs when campaign is resumed', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Resume Camp', status: 'PAUSED' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.resume as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: camp.id,
        status: 'ACTIVE',
      });

      const { sendingJobService } = await import('@signalforge/sending');

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/resume`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(sendingJobService.resumeCampaignJobs).toHaveBeenCalled();
    });

    it('cancels sending jobs when campaign is stopped', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Stop Camp', status: 'ACTIVE' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.stop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: camp.id,
        status: 'STOPPED',
      });

      const { sendingJobService } = await import('@signalforge/sending');

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/stop`,
        payload: { confirmed: true },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(sendingJobService.cancelCampaignJobs).toHaveBeenCalled();
    });
  });

  describe('unauthenticated', () => {
    it('rejects unauthenticated campaign requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/campaigns',
        query: { page: '1', limit: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
