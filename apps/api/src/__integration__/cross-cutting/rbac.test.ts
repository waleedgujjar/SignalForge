import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, addMember, as } from '../helpers/auth.js';
import { makeCampaign } from '../helpers/factories.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Cross-Cutting: RBAC Enforcement', () => {
  describe('unauthenticated access', () => {
    it('returns 401 for requests without a session cookie', async () => {
      const endpoints = [
        { method: 'GET' as const, url: '/leads', query: { page: '1', limit: '10' } },
        { method: 'GET' as const, url: '/campaigns', query: { page: '1', limit: '10' } },
        { method: 'GET' as const, url: '/automations', query: { page: '1', limit: '10' } },
        { method: 'GET' as const, url: '/suppressions', query: { page: '1', limit: '10' } },
        { method: 'GET' as const, url: '/lead-discovery/jobs', query: { page: '1', limit: '10' } },
      ];

      for (const ep of endpoints) {
        const res = await app.inject(ep);
        expect(res.statusCode, `${ep.method} ${ep.url}`).toBe(401);
      }
    });

    it('returns 401 for an expired session', async () => {
      const ctx = createTestUser({ email: 'expired@rbac.test' });
      const { stores } = await import('../helpers/mock-db.js');
      const session = stores.sessions.get(ctx.session.id)!;
      session.expiresAt = new Date(Date.now() - 1000);

      const res = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('MEMBER role', () => {
    it('MEMBER can create leads', async () => {
      const admin = createTestUser({ email: 'admin@rbac2.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, { email: 'member@rbac2.test', role: 'MEMBER' });

      const res = await app.inject({
        method: 'POST',
        url: '/leads',
        payload: { email: 'new-lead@test.com', firstName: 'Test', lastName: 'Lead' },
        ...as(member.sessionToken),
      });
      expect(res.statusCode).toBe(201);
    });

    it('MEMBER can list campaigns', async () => {
      const admin = createTestUser({ email: 'admin@rbac3.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, { email: 'member@rbac3.test', role: 'MEMBER' });

      makeCampaign(admin.workspaceId, { name: 'Visible' });

      const res = await app.inject({
        method: 'GET',
        url: '/campaigns',
        query: { page: '1', limit: '10' },
        ...as(member.sessionToken),
      });
      expect(res.statusCode).toBe(200);
    });

    it('MEMBER cannot update discovery sources (ADMIN required)', async () => {
      const admin = createTestUser({ email: 'admin@rbac4.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, { email: 'member@rbac4.test', role: 'MEMBER' });

      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as(member.sessionToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('MEMBER cannot publish a workflow (ADMIN required)', async () => {
      const admin = createTestUser({ email: 'admin@rbac5.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, { email: 'member@rbac5.test', role: 'MEMBER' });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/publish',
        ...as(member.sessionToken),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('ADMIN role', () => {
    it('ADMIN can update discovery sources', async () => {
      const admin = createTestUser({ email: 'admin@rbac6.test', role: 'ADMIN' });

      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as(admin.sessionToken),
      });
      expect(res.statusCode).toBe(200);
    });

    it('ADMIN can publish a workflow', async () => {
      const admin = createTestUser({ email: 'admin@rbac7.test', role: 'ADMIN' });

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.publish as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/publish',
        ...as(admin.sessionToken),
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
