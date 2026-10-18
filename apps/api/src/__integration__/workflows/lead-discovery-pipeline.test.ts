import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, addMember, as } from '../helpers/auth.js';
import { makeDiscoveryJob } from '../helpers/factories.js';
import { stores } from '../helpers/mock-db.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow C: Lead Discovery Pipeline', () => {
  describe('source configuration', () => {
    it('ADMIN can update lead source config', async () => {
      const ctx = createTestUser({ role: 'ADMIN' });

      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
    });

    it('MEMBER cannot update lead source config', async () => {
      const admin = createTestUser({ email: 'admin@disc.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, {
        email: 'member@disc.test',
        role: 'MEMBER',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as(member.sessionToken),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('job management', () => {
    it('creates a discovery job and returns 202', async () => {
      const ctx = createTestUser();

      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          query: { keywords: ['plumbers'], city: 'New York', maxResults: 50 },
        },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe('PENDING');

      const stored = stores.discoveryJobs.get(body.jobId);
      expect(stored).toBeDefined();
      expect(stored!.workspaceId).toBe(ctx.workspaceId);
    });

    it('lists discovery jobs paginated and workspace-scoped', async () => {
      const ctx = createTestUser();
      makeDiscoveryJob(ctx.workspaceId, { source: 'GOOGLE_MAPS_SCRAPER', status: 'COMPLETED' });
      makeDiscoveryJob(ctx.workspaceId, { source: 'GOOGLE_MAPS_SCRAPER', status: 'PENDING' });

      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.pagination.total).toBe(2);
    });

    it('gets a single job by ID', async () => {
      const ctx = createTestUser();
      const job = makeDiscoveryJob(ctx.workspaceId, { source: 'GOOGLE_MAPS_SCRAPER' });

      const res = await app.inject({
        method: 'GET',
        url: `/lead-discovery/jobs/${job.id}`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(job.id);
    });

    it('returns 404 for job from another workspace', async () => {
      const userA = createTestUser({ email: 'a@disc.test' });
      const userB = createTestUser({ email: 'b@disc.test' });
      const job = makeDiscoveryJob(userA.workspaceId, { source: 'GOOGLE_MAPS_SCRAPER' });

      const res = await app.inject({
        method: 'GET',
        url: `/lead-discovery/jobs/${job.id}`,
        ...as(userB.sessionToken),
      });

      expect(res.statusCode).toBe(404);
    });

    it('cancels a pending job', async () => {
      const ctx = createTestUser();
      const job = makeDiscoveryJob(ctx.workspaceId, {
        source: 'GOOGLE_MAPS_SCRAPER',
        status: 'PENDING',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/lead-discovery/jobs/${job.id}/cancel`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const stored = stores.discoveryJobs.get(job.id);
      expect(stored!.status).toBe('CANCELLED');
    });

    it('rejects cancel on already completed job', async () => {
      const ctx = createTestUser();
      const job = makeDiscoveryJob(ctx.workspaceId, {
        source: 'GOOGLE_MAPS_SCRAPER',
        status: 'COMPLETED',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/lead-discovery/jobs/${job.id}/cancel`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('save and promote', () => {
    it('promotes discovered leads to workspace leads', async () => {
      const ctx = createTestUser();
      const job = makeDiscoveryJob(ctx.workspaceId, {
        source: 'GOOGLE_MAPS_SCRAPER',
        status: 'COMPLETED',
      });

      const { promoteDiscoveredLeads } = await import('@signalforge/lead-discovery');
      (promoteDiscoveredLeads as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        promoted: 3,
        skipped: 1,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/lead-discovery/jobs/${job.id}/save`,
        payload: { discoveredLeadIds: ['dl-1', 'dl-2', 'dl-3', 'dl-4'] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(promoteDiscoveredLeads).toHaveBeenCalled();
    });
  });

  describe('unauthenticated', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs',
        query: { page: '1', limit: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
