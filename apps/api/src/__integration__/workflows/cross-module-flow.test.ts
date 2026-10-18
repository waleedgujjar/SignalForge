import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead, makeCampaign, makeTag, makeDiscoveryJob } from '../helpers/factories.js';
import { stores } from '../helpers/mock-db.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow H: Cross-Module Flow', () => {
  it('lead create → tag → enroll in campaign', async () => {
    const ctx = createTestUser();

    const createRes = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'cross@example.com', firstName: 'Cross', lastName: 'Module' },
      ...as(ctx.sessionToken),
    });
    expect(createRes.statusCode).toBe(201);
    const lead = createRes.json();

    const tag = makeTag(ctx.workspaceId, { name: 'Hot' });
    const tagRes = await app.inject({
      method: 'POST',
      url: `/leads/${lead.id}/tags`,
      payload: { tagIds: [tag.id] },
      ...as(ctx.sessionToken),
    });
    expect(tagRes.statusCode).toBe(200);

    const camp = makeCampaign(ctx.workspaceId, { name: 'Cross Camp', status: 'ACTIVE' });
    const { campaignLeadService } = await import('@signalforge/campaigns');
    (campaignLeadService.enrollLeads as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enrolled: 1,
      skipped: 0,
    });

    const enrollRes = await app.inject({
      method: 'POST',
      url: `/campaigns/${camp.id}/leads`,
      payload: { leadIds: [lead.id] },
      ...as(ctx.sessionToken),
    });
    expect(enrollRes.statusCode).toBe(200);
    expect(enrollRes.json().enrolled).toBe(1);
  });

  it('discovery promote → lead saved → workflow event published', async () => {
    const ctx = createTestUser();
    const job = makeDiscoveryJob(ctx.workspaceId, {
      source: 'GOOGLE_MAPS',
      status: 'COMPLETED',
    });

    const { promoteDiscoveredLeads } = await import('@signalforge/lead-discovery');
    (promoteDiscoveredLeads as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      promoted: 2,
      skipped: 0,
    });

    const saveRes = await app.inject({
      method: 'POST',
      url: `/lead-discovery/jobs/${job.id}/save`,
      payload: { discoveredLeadIds: ['dl-1', 'dl-2'] },
      ...as(ctx.sessionToken),
    });
    expect(saveRes.statusCode).toBe(200);
    expect(promoteDiscoveredLeads).toHaveBeenCalled();

    const updated = stores.discoveryJobs.get(job.id);
    expect(updated).toBeDefined();
  });

  it('lead status QUALIFIED triggers workflow event', async () => {
    const ctx = createTestUser();
    const lead = makeLead(ctx.workspaceId, { email: 'qualify@test.com', status: 'NEW' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/leads/${lead.id}`,
      payload: { status: 'QUALIFIED' },
      ...as(ctx.sessionToken),
    });

    expect(res.statusCode).toBe(200);
    const { publishWorkflowEvent } = await import('@signalforge/automations');
    expect(publishWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'LEAD_QUALIFIED',
        workspaceId: ctx.workspaceId,
        leadId: lead.id,
      }),
    );
  });

  it('campaign launch triggers sending bootstrap', async () => {
    const ctx = createTestUser();
    const camp = makeCampaign(ctx.workspaceId, { name: 'Full Launch', status: 'DRAFT' });

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

  it('workspace isolation across multiple modules', async () => {
    const userA = createTestUser({ email: 'iso-a@test.com' });
    const userB = createTestUser({ email: 'iso-b@test.com' });

    makeLead(userA.workspaceId, { email: 'a-lead@test.com' });
    makeCampaign(userA.workspaceId, { name: 'A Campaign' });

    const leadsRes = await app.inject({
      method: 'GET',
      url: '/leads',
      query: { page: '1', limit: '50' },
      ...as(userB.sessionToken),
    });
    expect(leadsRes.json().data.length).toBe(0);

    const campsRes = await app.inject({
      method: 'GET',
      url: '/campaigns',
      query: { page: '1', limit: '50' },
      ...as(userB.sessionToken),
    });
    expect(campsRes.json().data.length).toBe(0);
  });
});
