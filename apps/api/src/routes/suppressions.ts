import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { createSuppressionSchema, bulkSuppressionSchema, suppressionListQuerySchema } from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

export const suppressionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const { type, reason, page, limit } = suppressionListQuerySchema.parse(request.query);

    const skip = (page - 1) * limit;
    const suppressions = await prisma.suppression.findMany({
      where: {
        workspaceId,
        ...(type && { type }),
        ...(reason && { reason }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    });

    return suppressions;
  });

  app.post('/', async (request, reply) => {
    const body = createSuppressionSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const value = body.type === 'EMAIL' ? body.value.trim().toLowerCase() : body.value.trim().toLowerCase();

    const suppression = await prisma.suppression.upsert({
      where: {
        workspaceId_type_value: {
          workspaceId,
          type: body.type,
          value,
        },
      },
      create: {
        workspaceId,
        type: body.type,
        value,
        reason: body.reason,
        source: 'USER',
      },
      update: { reason: body.reason },
    });

    return reply.status(201).send(suppression);
  });

  app.post('/bulk', async (request, reply) => {
    const body = bulkSuppressionSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    const results = await Promise.all(
      body.entries.map((entry) => {
        const value = entry.value.trim().toLowerCase();
        return prisma.suppression.upsert({
          where: {
            workspaceId_type_value: {
              workspaceId,
              type: entry.type,
              value,
            },
          },
          create: {
            workspaceId,
            type: entry.type,
            value,
            reason: entry.reason,
            source: 'USER',
          },
          update: { reason: entry.reason },
        });
      }),
    );

    return reply.status(201).send({ imported: results.length, suppressions: results });
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);

    const { count } = await prisma.suppression.deleteMany({ where: { id, workspaceId } });
    if (count === 0) return reply.status(404).send({ error: 'Suppression not found' });

    return reply.status(204).send();
  });
};
