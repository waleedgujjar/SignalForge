import { describe, expect, it, beforeEach } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead, makeWebsiteAnalysis } from '../helpers/factories.js';
import { stores } from '../helpers/mock-db.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow E: Website Intelligence', () => {
  describe('analyze by lead', () => {
    it('enqueues analysis for existing lead and returns 202', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, {
        email: 'lead@example.com',
        website: 'https://example.com',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/website-intelligence/analyze',
        payload: { leadId: lead.id, url: 'https://example.com' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.leadId).toBe(lead.id);
      expect(body.analysisId).toBeDefined();

      const analysis = [...stores.websiteAnalyses.values()].find(
        (a) => a.leadId === lead.id,
      );
      expect(analysis).toBeDefined();
      expect(analysis!.status).toBe('PENDING');
    });

    it('returns 404 for lead from another workspace', async () => {
      const userA = createTestUser({ email: 'a@wi.test' });
      const userB = createTestUser({ email: 'b@wi.test' });
      const lead = makeLead(userA.workspaceId, { email: 'secret@a.com', website: 'https://a.com' });

      const res = await app.inject({
        method: 'POST',
        url: '/website-intelligence/analyze',
        payload: { leadId: lead.id, url: 'https://a.com' },
        ...as(userB.sessionToken),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('analyze by URL', () => {
    it('resolves lead by domain and enqueues analysis', async () => {
      const ctx = createTestUser();
      makeLead(ctx.workspaceId, {
        email: 'john@company.com',
        website: 'https://company.com',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/website-intelligence/analyze/url',
        payload: { url: 'https://company.com' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(202);
      expect(res.json().analysisId).toBeDefined();
    });
  });

  describe('analysis listing', () => {
    it('lists analyses paginated and workspace-scoped', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'list@test.com' });
      makeWebsiteAnalysis(ctx.workspaceId, { leadId: lead.id, url: 'https://a.com', status: 'COMPLETED' });
      makeWebsiteAnalysis(ctx.workspaceId, { leadId: lead.id, url: 'https://b.com', status: 'PENDING' });

      const res = await app.inject({
        method: 'GET',
        url: '/website-intelligence/analyses',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.analyses.length).toBe(2);
      expect(body.pagination.total).toBe(2);
    });

    it('returns 404 for analysis from another workspace', async () => {
      const userA = createTestUser({ email: 'a@anly.test' });
      const userB = createTestUser({ email: 'b@anly.test' });
      const lead = makeLead(userA.workspaceId, { email: 'priv@a.com' });
      const analysis = makeWebsiteAnalysis(userA.workspaceId, {
        leadId: lead.id,
        url: 'https://a.com',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/website-intelligence/analyses/${analysis.id}`,
        ...as(userB.sessionToken),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('unauthenticated', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/website-intelligence/analyses',
        query: { page: '1', limit: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
