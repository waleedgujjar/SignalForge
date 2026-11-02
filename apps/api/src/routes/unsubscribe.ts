import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '@signalforge/database';
import { verifyUnsubscribeToken } from '../unsubscribe-token.js';

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px;color:#1f2937"><h2>${title}</h2>${body}</body></html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function unsubscribe(token: string | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'Missing token' };
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return { ok: false, error: 'Invalid or expired unsubscribe link' };

  const lead = await prisma.lead.findUnique({ where: { id: payload.leadId } });
  if (!lead) return { ok: false, error: 'Invalid unsubscribe link' };

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
}

function wantsHtml(accept: string | undefined): boolean {
  return Boolean(accept && accept.includes('text/html'));
}

export const unsubscribeRoutes: FastifyPluginAsync = async (app) => {
  // RFC 8058 one-click unsubscribe (Gmail, Yahoo) POSTs
  // "List-Unsubscribe=One-Click" as a form body, and so does the confirmation
  // form below. Fastify only parses JSON and text by default and answered these
  // with 415, so one-click unsubscribes failed. The body carries nothing we need.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Opening the link shows a confirmation page and changes nothing: mail
  // security scanners fetch every link in a message, and a GET that
  // unsubscribed removed people who never asked to leave.
  app.get('/', async (request, reply: FastifyReply) => {
    const { token } = request.query as { token?: string };
    if (!token || !verifyUnsubscribeToken(token)) {
      return reply
        .status(400)
        .type('text/html')
        .send(page('Link not valid', '<p>This unsubscribe link is invalid or has expired.</p>'));
    }
    return reply
      .type('text/html')
      .send(
        page(
          'Unsubscribe',
          `<p>Click below to stop receiving these emails.</p><form method="post" action="?token=${escapeAttr(encodeURIComponent(token))}"><button type="submit" style="font-size:16px;padding:10px 20px;border-radius:6px;border:1px solid #d1d5db;background:#111827;color:#fff;cursor:pointer">Unsubscribe</button></form>`,
        ),
      );
  });

  app.post('/', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const result = await unsubscribe(token);
    const html = wantsHtml(request.headers.accept);
    if (!result.ok) {
      return html
        ? reply.status(400).type('text/html').send(page('Link not valid', `<p>${result.error}.</p>`))
        : reply.status(400).send({ error: result.error });
    }
    return html
      ? reply.type('text/html').send(page('Unsubscribed', '<p>You have been unsubscribed and will not receive further emails.</p>'))
      : { ok: true };
  });
};
