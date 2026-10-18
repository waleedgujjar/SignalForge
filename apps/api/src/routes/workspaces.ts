import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { type MemberRole, hashToken } from '@signalforge/auth';
import {
  onboardingSchema,
  createWorkspaceSchema,
  switchWorkspaceSchema,
  sessionResponseSchema,
  updateWorkspaceSettingsSchema,
} from '@signalforge/validation';
import {
  SESSION_COOKIE,
  buildSessionResponse,
  authenticate,
  authenticateAndRequireWorkspace,
} from '../plugins/auth.js';
import { slugify } from './auth.js';

async function createWorkspaceForUser(
  userId: string,
  name: string,
  primaryUseCase?: string,
  sessionToken?: string,
) {
  let slug = slugify(name);
  const slugExists = await prisma.workspace.findUnique({ where: { slug } });
  if (slugExists) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name,
        slug,
        onboardingMeta: primaryUseCase ? { primaryUseCase } : undefined,
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
    });

    return created;
  });

  if (sessionToken) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(sessionToken) },
      data: { activeWorkspaceId: workspace.id },
    });
  }

  return workspace;
}

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: request.user.userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role as MemberRole,
    }));
  });

  app.get('/current', { preHandler: authenticateAndRequireWorkspace }, async (request, reply) => {
    if (!request.user?.workspaceId) {
      return reply.status(403).send({ error: 'No active workspace' });
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: request.user.workspaceId,
          userId: request.user.userId,
        },
      },
      include: {
        workspace: {
          include: {
            members: {
              select: { id: true },
            },
          },
        },
      },
    });

    if (!membership) return reply.status(403).send({ error: 'Not a workspace member' });

    const ws = membership.workspace;
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      logoUrl: ws.logoUrl,
      timezone: ws.timezone,
      defaultFromName: ws.defaultFromName,
      defaultReplyTo: ws.defaultReplyTo,
      memberCount: ws.members.length,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
      role: membership.role,
    };
  });

  app.patch('/current', { preHandler: authenticateAndRequireWorkspace }, async (request, reply) => {
    if (!request.user?.workspaceId) {
      return reply.status(403).send({ error: 'No active workspace' });
    }

    if (!request.user.role || !['OWNER', 'ADMIN'].includes(request.user.role)) {
      return reply.status(403).send({ error: 'Only owners and admins can update workspace settings' });
    }

    const body = updateWorkspaceSettingsSchema.parse(request.body);

    const workspace = await prisma.workspace.update({
      where: { id: request.user.workspaceId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.timezone !== undefined && { timezone: body.timezone }),
        ...(body.defaultFromName !== undefined && { defaultFromName: body.defaultFromName }),
        ...(body.defaultReplyTo !== undefined && { defaultReplyTo: body.defaultReplyTo }),
        ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
      },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoUrl,
      timezone: workspace.timezone,
      defaultFromName: workspace.defaultFromName,
      defaultReplyTo: workspace.defaultReplyTo,
      updatedAt: workspace.updatedAt.toISOString(),
    };
  });

  app.post('/onboarding', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const body = onboardingSchema.parse(request.body);
    const token = request.cookies[SESSION_COOKIE];

    await createWorkspaceForUser(
      request.user.userId,
      body.workspaceName,
      body.primaryUseCase,
      token,
    );

    if (!token) return reply.status(401).send({ error: 'Unauthorized' });

    const payload = await buildSessionResponse(request.user.userId, token);
    return sessionResponseSchema.parse(payload);
  });

  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const body = createWorkspaceSchema.parse(request.body);
    const token = request.cookies[SESSION_COOKIE];

    const workspace = await createWorkspaceForUser(request.user.userId, body.name, undefined, token);

    return reply.status(201).send({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: 'OWNER' as MemberRole,
    });
  });

  app.post('/switch', { preHandler: authenticate }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const body = switchWorkspaceSchema.parse(request.body);
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return reply.status(401).send({ error: 'Unauthorized' });

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: body.workspaceId,
          userId: request.user.userId,
        },
      },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this workspace' });
    }

    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { activeWorkspaceId: body.workspaceId },
    });

    const payload = await buildSessionResponse(request.user.userId, token);
    return sessionResponseSchema.parse(payload);
  });
};
