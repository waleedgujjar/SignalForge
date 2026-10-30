import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '@signalforge/database';
import { deliveryEventService } from '@signalforge/deliverability';
import { loadEnv } from '@signalforge/config';
import { verifyOpenTrackingToken } from '../open-tracking-token.js';

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Best-effort classification of automated/proxy opens. Email open tracking is
 * approximate: image proxies (Gmail), scanners, and privacy relays can load the
 * pixel without a human reading the mail. We record such events anyway (never
 * silently dropped) but flag them so the UI can label "recorded" vs "likely
 * human" opens. Apple Mail Privacy Protection is not reliably detectable and is
 * called out in the UI copy instead.
 */
function classifyOpen(userAgent: string | undefined): { automated: boolean; reason?: string } {
  if (!userAgent) return { automated: true, reason: 'no-user-agent' };
  const ua = userAgent.toLowerCase();
  if (ua.includes('googleimageproxy')) return { automated: true, reason: 'gmail-image-proxy' };
  if (ua.includes('yahoomailproxy')) return { automated: true, reason: 'yahoo-proxy' };
  if (ua.includes('bingpreview')) return { automated: true, reason: 'bing-preview' };
  if (/\b(bot|spider|crawler|scanner|preview|monitor)\b/.test(ua)) return { automated: true, reason: 'bot' };
  return { automated: false };
}

function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  // Store a salted hash, never the raw IP, purely for coarse de-dup/analysis.
  return createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 16);
}

function sendPixel(reply: FastifyReply): FastifyReply {
  return reply
    .header('Content-Type', 'image/gif')
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    .header('Pragma', 'no-cache')
    .header('Expires', '0')
    .send(PIXEL);
}

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  // Public, unauthenticated: a recipient's email client loads this. It always
  // returns the pixel (never an error, never any data) so it cannot leak whether
  // a token is valid, and open recording happens as a best-effort side effect.
  app.get('/open.gif', async (request, reply) => {
    const { t } = request.query as { t?: string };

    // Fire the DB work but never let it block or fail the image response.
    void recordOpen(t, request.headers['user-agent'], request.ip).catch((error) => {
      app.log.warn({ err: error, msg: 'open-tracking: failed to record open' });
    });

    return sendPixel(reply);
  });
};

async function recordOpen(
  token: string | undefined,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<void> {
  if (!token) return;
  const payload = verifyOpenTrackingToken(token);
  if (!payload) return;

  const message = await prisma.emailMessage.findUnique({
    where: { trackingId: payload.trackingId },
    select: {
      id: true,
      workspaceId: true,
      campaignId: true,
      campaignLeadId: true,
      leadId: true,
      mailboxId: true,
      firstOpenedAt: true,
    },
  });
  if (!message) return;

  const env = loadEnv();
  const now = new Date();
  // Collapse the rapid duplicate pixel loads a single open produces (email
  // clients often fetch 2-3x) into one event per minute, while still counting a
  // genuine re-open in a later minute as a separate event.
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  const classification = classifyOpen(userAgent);

  const result = await deliveryEventService.recordEvent({
    workspaceId: message.workspaceId,
    eventType: 'OPENED',
    idempotencyKey: `open:${payload.trackingId}:${minuteBucket}`,
    emailMessageId: message.id,
    leadId: message.leadId,
    campaignId: message.campaignId,
    mailboxId: message.mailboxId,
    source: 'TRACKING',
    occurredAt: now,
    metadata: {
      campaignLeadId: message.campaignLeadId,
      automated: classification.automated,
      ...(classification.reason ? { automatedReason: classification.reason } : {}),
      ipHash: hashIp(ip, env.SESSION_SECRET),
    },
  });

  // Only advance the per-message summary when a genuinely new event was created,
  // so the rapid duplicate loads within a minute do not inflate the count.
  if (result.created) {
    await prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        openCount: { increment: 1 },
        lastOpenedAt: now,
        ...(message.firstOpenedAt ? {} : { firstOpenedAt: now }),
      },
    });
  }
}
