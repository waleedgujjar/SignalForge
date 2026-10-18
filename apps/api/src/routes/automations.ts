import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  getTemplates,
  notificationService,
  validateWorkflowGraph,
  workflowService,
  workflowStatsService,
} from '@signalforge/automations';
import {
  createWorkflowFromTemplateSchema,
  createWorkflowSchema,
  notificationListQuerySchema,
  updateWorkflowSchema,
  workflowExecutionListQuerySchema,
  workflowListQuerySchema,
  workflowLogsQuerySchema,
} from '@signalforge/validation';
import {
  getWorkspaceId,
  requireWorkspaceGuard,
  requireWorkspaceRole,
} from '../plugins/auth.js';

function getActorUserId(request: { user?: { userId?: string } }): string | undefined {
  return request.user?.userId;
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error) {
    if (error.message === 'Workflow not found' || error.message === 'Execution not found') {
      return reply.status(404).send({ error: error.message });
    }
    if (error.message.startsWith('[') && error.message.includes('SELF_TRIGGER')) {
      return reply.status(400).send({ error: 'Validation failed', details: JSON.parse(error.message) });
    }
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

export const automationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/', async (request) => {
    const query = workflowListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);
    return workflowService.list(workspaceId, query.status);
  });

  app.post('/', async (request, reply) => {
    const body = createWorkflowSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    const workflow = await workflowService.create(workspaceId, {
      ...body,
      createdById: actorUserId,
    });
    return reply.status(201).send(workflow);
  });

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);
    return workflowStatsService.listWorkspaceStats(workspaceId);
  });

  app.get('/templates', async () => {
    return getTemplates();
  });

  app.post('/from-template', async (request, reply) => {
    const body = createWorkflowFromTemplateSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    const workflow = await workflowService.fromTemplate(body.templateId, workspaceId, actorUserId);
    return reply.status(201).send(workflow);
  });

  app.get('/notifications', async (request, reply) => {
    const query = notificationListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);
    const userId = getActorUserId(request);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    const [items, unreadCount] = await Promise.all([
      notificationService.list(workspaceId, userId, {
        unreadOnly: query.unreadOnly,
        limit: query.limit,
      }),
      notificationService.unreadCount(workspaceId, userId),
    ]);
    return { items, unreadCount };
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const userId = getActorUserId(request);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      const notification = await notificationService.markRead(id, workspaceId, userId);
      return notification;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.getById(id, workspaceId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateWorkflowSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      return await workflowService.updateDraft(id, workspaceId, body, actorUserId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/:id/publish', {
    preHandler: requireWorkspaceRole('ADMIN').preHandler,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      return await workflowService.publish(id, workspaceId, actorUserId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/:id/pause', {
    preHandler: requireWorkspaceRole('ADMIN').preHandler,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      return await workflowService.pause(id, workspaceId, actorUserId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/:id/resume', {
    preHandler: requireWorkspaceRole('ADMIN').preHandler,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      return await workflowService.resume(id, workspaceId, actorUserId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/:id/archive', {
    preHandler: requireWorkspaceRole('ADMIN').preHandler,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      return await workflowService.archive(id, workspaceId, actorUserId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const actorUserId = getActorUserId(request);
    try {
      const workflow = await workflowService.duplicate(id, workspaceId, actorUserId);
      return reply.status(201).send(workflow);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/:id/validate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    try {
      const workflow = await workflowService.getById(id, workspaceId);
      const draft = workflow.versions[0] ?? workflow.publishedVersion;
      if (!draft) return { valid: false, errors: [{ code: 'NO_DRAFT', message: 'No graph to validate' }] };
      return validateWorkflowGraph(draft.nodes, draft.edges);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/:id/executions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = workflowExecutionListQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.listExecutions(id, workspaceId, query.limit);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/:id/logs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = workflowLogsQuerySchema.parse(request.query);
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.listLogs(id, workspaceId, query.limit);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/:id/activities', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.listActivities(id, workspaceId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/executions/:executionId', async (request, reply) => {
    const { executionId } = request.params as { executionId: string };
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.getExecution(executionId, workspaceId);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/executions/:executionId/cancel', async (request, reply) => {
    const { executionId } = request.params as { executionId: string };
    const workspaceId = getWorkspaceId(request);
    try {
      return await workflowService.cancelExecution(executionId, workspaceId);
    } catch (error) {
      return handleError(error, reply);
    }
  });
};
