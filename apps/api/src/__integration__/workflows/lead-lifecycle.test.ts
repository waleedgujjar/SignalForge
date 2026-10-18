import { describe, expect, it, beforeEach } from 'vitest';
import { createTestUser, as } from '../helpers/auth.js';
import { makeLead, makeTag, makeList } from '../helpers/factories.js';
import { stores } from '../helpers/mock-db.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow B: Lead Lifecycle', () => {
  describe('lead CRUD', () => {
    it('creates a lead with workspace scoping', async () => {
      const ctx = createTestUser();

      const res = await app.inject({
        method: 'POST',
        url: '/leads',
        payload: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.email).toBe('jane@example.com');
      expect(body.fullName).toBe('Jane Doe');
      expect(body.workspaceId).toBe(ctx.workspaceId);

      const stored = [...stores.leads.values()].find((l) => l.email === 'jane@example.com');
      expect(stored).toBeDefined();
    });

    it('lists leads with pagination, workspace-scoped', async () => {
      const ctx = createTestUser();
      makeLead(ctx.workspaceId, { email: 'a@test.com' });
      makeLead(ctx.workspaceId, { email: 'b@test.com' });

      const res = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.page).toBe(1);
    });

    it('gets a single lead by ID', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'single@test.com', firstName: 'Single' });

      const res = await app.inject({
        method: 'GET',
        url: `/leads/${lead.id}`,
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().email).toBe('single@test.com');
    });

    it('updates a lead and computes fullName', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'update@test.com', firstName: 'Old' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/leads/${lead.id}`,
        payload: { firstName: 'Updated', lastName: 'Name' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.firstName).toBe('Updated');
      expect(body.fullName).toBe('Updated Name');
    });

    it('deletes a lead and returns 204', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'delete@test.com' });

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/leads/${lead.id}`,
        ...as(ctx.sessionToken),
      });
      expect(delRes.statusCode).toBe(204);

      const getRes = await app.inject({
        method: 'GET',
        url: `/leads/${lead.id}`,
        ...as(ctx.sessionToken),
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for lead in another workspace', async () => {
      const userA = createTestUser({ email: 'owner-a@ws.test' });
      const userB = createTestUser({ email: 'owner-b@ws.test' });
      const lead = makeLead(userA.workspaceId, { email: 'private@a.com' });

      const res = await app.inject({
        method: 'GET',
        url: `/leads/${lead.id}`,
        ...as(userB.sessionToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('workspace isolation', () => {
    it('workspace B cannot see workspace A leads in listing', async () => {
      const userA = createTestUser({ email: 'a@ws.test' });
      const userB = createTestUser({ email: 'b@ws.test' });

      makeLead(userA.workspaceId, { email: 'secret@a.com' });
      makeLead(userA.workspaceId, { email: 'also-secret@a.com' });
      makeLead(userB.workspaceId, { email: 'visible@b.com' });

      const res = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', limit: '50' },
        ...as(userB.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].email).toBe('visible@b.com');
    });
  });

  describe('tags', () => {
    it('creates a tag scoped to workspace', async () => {
      const ctx = createTestUser();

      const res = await app.inject({
        method: 'POST',
        url: '/leads/tags',
        payload: { name: 'VIP' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      const tag = res.json();
      expect(tag.name).toBe('VIP');
      expect(tag.workspaceId).toBe(ctx.workspaceId);
    });

    it('assigns tag to lead and returns count', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'tagged@test.com' });
      const tag = makeTag(ctx.workspaceId, { name: 'VIP' });

      const res = await app.inject({
        method: 'POST',
        url: `/leads/${lead.id}/tags`,
        payload: { tagIds: [tag.id] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().added).toBe(1);
    });
  });

  describe('lists', () => {
    it('creates a list scoped to workspace', async () => {
      const ctx = createTestUser();

      const res = await app.inject({
        method: 'POST',
        url: '/leads/lists',
        payload: { name: 'Hot Prospects' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      const list = res.json();
      expect(list.name).toBe('Hot Prospects');
      expect(list.workspaceId).toBe(ctx.workspaceId);
    });

    it('adds leads to a list and returns count', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'listed@test.com' });
      const list = makeList(ctx.workspaceId, { name: 'My List' });

      const res = await app.inject({
        method: 'POST',
        url: `/leads/lists/${list.id}/members`,
        payload: { leadIds: [lead.id] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().added).toBe(1);
    });
  });

  describe('notes', () => {
    it('creates a note on a lead', async () => {
      const ctx = createTestUser();
      const lead = makeLead(ctx.workspaceId, { email: 'noted@test.com' });

      const res = await app.inject({
        method: 'POST',
        url: `/leads/${lead.id}/notes`,
        payload: { content: 'Spoke on the phone' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().content).toBe('Spoke on the phone');
      expect(res.json().leadId).toBe(lead.id);
    });
  });

  describe('bulk operations', () => {
    it('bulk deletes leads in workspace', async () => {
      const ctx = createTestUser();
      const l1 = makeLead(ctx.workspaceId, { email: 'bulk1@test.com' });
      const l2 = makeLead(ctx.workspaceId, { email: 'bulk2@test.com' });
      makeLead(ctx.workspaceId, { email: 'keep@test.com' });

      const res = await app.inject({
        method: 'POST',
        url: '/leads/bulk/delete',
        payload: { leadIds: [l1.id, l2.id] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(2);

      const listRes = await app.inject({
        method: 'GET',
        url: '/leads',
        query: { page: '1', limit: '50' },
        ...as(ctx.sessionToken),
      });
      expect(listRes.json().data.length).toBe(1);
    });

    it('bulk status update publishes workflow events', async () => {
      const ctx = createTestUser();
      const l1 = makeLead(ctx.workspaceId, { email: 'q1@test.com' });
      const l2 = makeLead(ctx.workspaceId, { email: 'q2@test.com' });

      const res = await app.inject({
        method: 'POST',
        url: '/leads/bulk/status',
        payload: { leadIds: [l1.id, l2.id], status: 'QUALIFIED' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(2);

      const { publishWorkflowEvent } = await import('@signalforge/automations');
      expect(publishWorkflowEvent).toHaveBeenCalledTimes(2);
    });
  });
});
