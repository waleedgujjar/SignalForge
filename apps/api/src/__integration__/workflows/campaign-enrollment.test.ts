import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeCampaign, makeLead } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow D: Campaign Enrollment', () => {
  describe('campaign CRUD', () => {
    it('creates a draft campaign via service', async () => {
      const ctx = createTestUser();

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.createDraft as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'camp-1',
        name: 'Test Campaign',
        status: 'DRAFT',
        workspaceId: ctx.workspaceId,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/campaigns',
        payload: { name: 'Test Campaign' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      expect(campaignService.createDraft).toHaveBeenCalled();
    });

    it('lists campaigns paginated and workspace-scoped', async () => {
      const ctx = createTestUser();
      makeCampaign(ctx.workspaceId, { name: 'Camp A' });
      makeCampaign(ctx.workspaceId, { name: 'Camp B' });

      const res = await app.inject({
        method: 'GET',
        url: '/campaigns',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.pagination.total).toBe(2);
    });

    it('gets a single campaign by ID', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Detail Camp' });

      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${camp.id}`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Detail Camp');
    });

    it('returns 404 for campaign from another workspace', async () => {
      const userA = createTestUser({ email: 'a@test.com' });
      const userB = createTestUser({ email: 'b@test.com' });
      const camp = makeCampaign(userA.workspaceId, { name: 'Private' });

      const res = await app.inject({
        method: 'GET',
        url: `/campaigns/${camp.id}`,
        ...as(userB.sessionToken),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('campaign steps', () => {
    it('adds a step to a campaign', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Sequence Camp' });

      const { sequenceService } = await import('@signalforge/campaigns');
      (sequenceService.addStep as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'step-1',
        campaignId: camp.id,
        order: 1,
        type: 'EMAIL',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/steps`,
        payload: {
          type: 'EMAIL',
          subjectTemplate: 'Hello {{firstName}}',
          bodyTemplate: '<p>Hi {{firstName}}</p>',
          delayDays: 0,
        },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      expect(sequenceService.addStep).toHaveBeenCalled();
    });
  });

  describe('lead enrollment', () => {
    it('enrolls leads into campaign', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Enrollment Camp', status: 'ACTIVE' });
      const lead = makeLead(ctx.workspaceId, { email: 'enroll@test.com' });

      const { campaignLeadService } = await import('@signalforge/campaigns');
      (campaignLeadService.enrollLeads as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        enrolled: 1,
        skipped: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/leads`,
        payload: { leadIds: [lead.id] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(campaignLeadService.enrollLeads).toHaveBeenCalled();
    });
  });

  describe('campaign lifecycle', () => {
    it('validates a campaign', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Validate Camp' });

      const { campaignValidationService } = await import('@signalforge/campaigns');
      (campaignValidationService.validate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: true,
        errors: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/validate`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().valid).toBe(true);
    });

    it('launches a campaign and bootstraps sending', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Launch Camp', status: 'DRAFT' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.launch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        campaign: { id: camp.id, status: 'ACTIVE' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/launch`,
        payload: {},
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(campaignService.launch).toHaveBeenCalled();
    });

    it('pauses an active campaign', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Pause Camp', status: 'ACTIVE' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.pause as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: camp.id,
        status: 'PAUSED',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/campaigns/${camp.id}/pause`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(campaignService.pause).toHaveBeenCalled();
    });

    it('archives a campaign via DELETE', async () => {
      const ctx = createTestUser();
      const camp = makeCampaign(ctx.workspaceId, { name: 'Archive Camp' });

      const { campaignService } = await import('@signalforge/campaigns');
      (campaignService.archive as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

      const res = await app.inject({
        method: 'DELETE',
        url: `/campaigns/${camp.id}`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('unauthenticated', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/campaigns',
        query: { page: '1', limit: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
