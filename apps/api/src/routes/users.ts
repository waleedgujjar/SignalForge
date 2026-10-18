import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { updateProfileSchema } from '@signalforge/validation';
import { authenticate } from '../plugins/auth.js';

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/profile', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      include: {
        memberships: {
          include: { workspace: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) return reply.status(404).send({ error: 'User not found' });

    const activeMembership = request.user.workspaceId
      ? user.memberships.find((m) => m.workspaceId === request.user!.workspaceId)
      : user.memberships[0];

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      role: activeMembership?.role ?? null,
      workspace: activeMembership
        ? {
            id: activeMembership.workspace.id,
            name: activeMembership.workspace.name,
            slug: activeMembership.workspace.slug,
          }
        : null,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  });

  app.patch('/profile', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const body = updateProfileSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: {
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      updatedAt: user.updatedAt.toISOString(),
    };
  });
};
