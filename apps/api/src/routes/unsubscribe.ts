import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { verifyUnsubscribeToken } from '../unsubscribe-token.js';

export const unsubscribeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.status(400).send({ error: 'Missing token' });
    }

    const payload = verifyUnsubscribeToken(token);
    if (!payload) {
      return reply.status(400).send({ error: 'Invalid or expired unsubscribe link' });
    }

    const lead = await prisma.lead.findUnique({ where: { id: payload.leadId } });
    if (!lead) {
      return reply.status(400).send({ error: 'Invalid unsubscribe link' });
    }

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: payload.leadId },
        data: { status: 'UNSUBSCRIBED' },
      }),
      prisma.suppression.upsert({
        where: {
          workspaceId_type_value: {
            workspaceId: lead.workspaceId,
            type: 'EMAIL',
            value: lead.email.toLowerCase(),
          },
        },
        create: {
          workspaceId: lead.workspaceId,
          type: 'EMAIL',
          value: lead.email.toLowerCase(),
          reason: 'UNSUBSCRIBED',
        },
        update: { reason: 'UNSUBSCRIBED' },
      }),
    ]);

    return reply
      .type('text/html')
      .send('<html><body style="font-family:sans-serif;text-align:center;padding:48px"><h2>Unsubscribed</h2><p>You have been successfully unsubscribed.</p></body></html>');
  });

  app.post('/', async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.status(400).send({ error: 'Missing token' });
    }

    const payload = verifyUnsubscribeToken(token);
    if (!payload) {
      return reply.status(400).send({ error: 'Invalid or expired unsubscribe link' });
    }

    const lead = await prisma.lead.findUnique({ where: { id: payload.leadId } });
    if (!lead) {
      return reply.status(400).send({ error: 'Invalid unsubscribe link' });
    }

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: payload.leadId },
        data: { status: 'UNSUBSCRIBED' },
      }),
      prisma.suppression.upsert({
        where: {
          workspaceId_type_value: {
            workspaceId: lead.workspaceId,
            type: 'EMAIL',
            value: lead.email.toLowerCase(),
          },
        },
        create: {
          workspaceId: lead.workspaceId,
          type: 'EMAIL',
          value: lead.email.toLowerCase(),
          reason: 'UNSUBSCRIBED',
        },
        update: { reason: 'UNSUBSCRIBED' },
      }),
    ]);

    return { ok: true };
  });
};
