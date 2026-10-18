import type { FastifyPluginAsync } from 'fastify';
import {
  MailboxNotInWorkspaceError,
  PoolNameConflictError,
  PoolNotFoundError,
  smtpPoolService,
} from '@signalforge/allocation';
import {
  addPoolMemberSchema,
  createSmtpPoolSchema,
  updatePoolMemberSchema,
  updateSmtpPoolSchema,
} from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

function handlePoolError(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (error instanceof PoolNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof PoolNameConflictError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof MailboxNotInWorkspaceError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof Error) {
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

export const smtpPoolRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/', async (request) => {
    const workspaceId = getWorkspaceId(request);
    return smtpPoolService.listPools(workspaceId);
  });

  app.post('/', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const body = createSmtpPoolSchema.parse(request.body);
    try {
      const pool = await smtpPoolService.createPool({ workspaceId, ...body });
      return reply.status(201).send(pool);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.get('/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      return await smtpPoolService.getPool(workspaceId, id);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.patch('/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = updateSmtpPoolSchema.parse(request.body);
    try {
      return await smtpPoolService.updatePool(workspaceId, id, body);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.delete('/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      await smtpPoolService.deletePool(workspaceId, id);
      return reply.status(204).send();
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.post('/:id/accounts', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = addPoolMemberSchema.parse(request.body);
    try {
      const member = await smtpPoolService.addMember({
        poolId: id,
        workspaceId,
        mailboxId: body.mailboxId,
        priority: body.priority,
        enabled: body.enabled,
      });
      return reply.status(201).send(member);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.patch('/:id/accounts/:accountId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id, accountId } = request.params as { id: string; accountId: string };
    const body = updatePoolMemberSchema.parse(request.body);
    try {
      return await smtpPoolService.updateMember(workspaceId, id, accountId, body);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.delete('/:id/accounts/:accountId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id, accountId } = request.params as { id: string; accountId: string };
    try {
      await smtpPoolService.removeMember(workspaceId, id, accountId);
      return reply.status(204).send();
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });

  app.get('/:id/health', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      return await smtpPoolService.getPoolHealth(workspaceId, id);
    } catch (error) {
      return handlePoolError(error, reply);
    }
  });
};
