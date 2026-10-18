import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTestUser, addMember, as } from '../helpers/auth.js';

let app: Awaited<ReturnType<typeof import('../../app.js').buildApp>>;

beforeEach(async () => {
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
});

describe('Workflow F: Workflow Automation', () => {
  describe('workflow CRUD', () => {
    it('creates a workflow via service', async () => {
      const ctx = createTestUser();

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        name: 'New Lead Workflow',
        status: 'DRAFT',
        workspaceId: ctx.workspaceId,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations',
        payload: { name: 'New Lead Workflow', trigger: 'LEAD_CREATED', nodes: [], edges: [] },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(201);
      expect(workflowService.create).toHaveBeenCalled();
    });

    it('lists workflows', async () => {
      const ctx = createTestUser();

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        workflows: [
          { id: 'wf-1', name: 'WF 1', status: 'ACTIVE' },
          { id: 'wf-2', name: 'WF 2', status: 'DRAFT' },
        ],
        total: 2,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/automations',
        query: { page: '1', limit: '10' },
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workflows.length).toBe(2);
    });

    it('gets a workflow by ID', async () => {
      const ctx = createTestUser();

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        name: 'Detail WF',
        status: 'DRAFT',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/automations/wf-1',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Detail WF');
    });

    it('returns 404 when workflow not found', async () => {
      const ctx = createTestUser();

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.getById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Workflow not found'),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/automations/nonexistent',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('lifecycle transitions', () => {
    it('ADMIN can publish a workflow', async () => {
      const ctx = createTestUser({ role: 'ADMIN' });

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.publish as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        status: 'ACTIVE',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/publish',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(workflowService.publish).toHaveBeenCalled();
    });

    it('MEMBER cannot publish a workflow', async () => {
      const admin = createTestUser({ email: 'admin@wf.test', role: 'ADMIN' });
      const member = addMember(admin.workspaceId, {
        email: 'member@wf.test',
        role: 'MEMBER',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/publish',
        ...as(member.sessionToken),
      });

      expect(res.statusCode).toBe(403);
    });

    it('ADMIN can pause a workflow', async () => {
      const ctx = createTestUser({ role: 'ADMIN' });

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.pause as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        status: 'PAUSED',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/pause',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
    });

    it('ADMIN can archive a workflow', async () => {
      const ctx = createTestUser({ role: 'ADMIN' });

      const { workflowService } = await import('@signalforge/automations');
      (workflowService.archive as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        status: 'ARCHIVED',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/automations/wf-1/archive',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('validation', () => {
    it('validates a workflow graph', async () => {
      const ctx = createTestUser();

      const { workflowService, validateWorkflowGraph } = await import('@signalforge/automations');
      (workflowService.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'wf-1',
        name: 'Test WF',
        versions: [{ nodes: [], edges: [] }],
      });
      (validateWorkflowGraph as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        valid: true,
        errors: [],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/automations/wf-1/validate',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().valid).toBe(true);
    });
  });

  describe('templates', () => {
    it('lists available templates', async () => {
      const ctx = createTestUser();

      const { getTemplates } = await import('@signalforge/automations');
      (getTemplates as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { id: 'tpl-1', name: 'Welcome Series' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/automations/templates',
        ...as(ctx.sessionToken),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('Welcome Series');
    });
  });

  describe('unauthenticated', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/automations',
        query: { page: '1', limit: '10' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
