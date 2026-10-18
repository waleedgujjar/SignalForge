import type { FastifyPluginAsync } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  GoogleDriveAdapter,
  encryptTokens,
  decryptTokens,
} from '@signalforge/integrations';
import {
  connectIntegrationSchema,
  oauthCallbackSchema,
} from '@signalforge/validation';
import {
  requireWorkspaceGuard,
  getWorkspaceId,
} from '../plugins/auth.js';

function signState(payload: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyState(
  signed: string,
  secret: string,
): Record<string, unknown> | null {
  const [b64, sig] = signed.split('.');
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, 'base64url').toString();
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(payload);
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function getAdapter() {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth not configured');
  }
  return new GoogleDriveAdapter(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

function getRedirectUri() {
  const env = loadEnv();
  return env.GOOGLE_REDIRECT_URI ?? `${env.API_URL}/integrations/callback`;
}

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', requireWorkspaceGuard(), async (request) => {
    const workspaceId = getWorkspaceId(request);
    const integrations = await prisma.integrationAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        provider: true,
        status: true,
        accountEmail: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return integrations;
  });

  app.post('/connect', requireWorkspaceGuard(), async (request, reply) => {
    const { provider } = connectIntegrationSchema.parse(request.body);
    const env = loadEnv();

    if (provider === 'GOOGLE_DRIVE') {
      const adapter = getAdapter();
      const nonce = randomBytes(16).toString('hex');
      const payload = JSON.stringify({
        workspaceId: getWorkspaceId(request),
        userId: request.user!.userId,
        provider,
        nonce,
        exp: Date.now() + 10 * 60 * 1000,
      });
      const state = signState(payload, env.SESSION_SECRET);
      const authUrl = adapter.getAuthUrl(state, getRedirectUri());
      return { authUrl };
    }

    return reply.status(400).send({ error: 'Unsupported provider' });
  });

  app.get('/callback', async (request, reply) => {
    const env = loadEnv();
    const appUrl = env.APP_URL;
    const errorRedirect = (msg: string) =>
      reply.redirect(`${appUrl}/settings/integrations?error=${encodeURIComponent(msg)}`);

    try {
      const query = oauthCallbackSchema.parse(request.query);
      const stateData = verifyState(query.state, env.SESSION_SECRET);
      if (!stateData) return errorRedirect('Invalid or expired authorization');

      const { workspaceId, userId, provider } = stateData as {
        workspaceId: string;
        userId: string;
        provider: string;
      };

      if (provider !== 'GOOGLE_DRIVE') {
        return errorRedirect('Unsupported provider');
      }

      const adapter = getAdapter();
      const { tokens, email } = await adapter.exchangeCode(
        query.code,
        getRedirectUri(),
      );

      const { encryptedPayload, keyVersion } = encryptTokens(
        tokens,
        env.ENCRYPTION_KEY,
      );

      await prisma.integrationAccount.upsert({
        where: {
          workspaceId_provider_accountEmail: {
            workspaceId,
            provider: 'GOOGLE_DRIVE',
            accountEmail: email,
          },
        },
        create: {
          workspaceId,
          provider: 'GOOGLE_DRIVE',
          status: 'CONNECTED',
          accountEmail: email,
          encryptedTokens: encryptedPayload,
          keyVersion,
          tokenExpiresAt: new Date(tokens.expiresAt),
          connectedByUserId: userId,
        },
        update: {
          status: 'CONNECTED',
          encryptedTokens: encryptedPayload,
          keyVersion,
          tokenExpiresAt: new Date(tokens.expiresAt),
        },
      });

      return reply.redirect(`${appUrl}/settings/integrations?connected=google_drive`);
    } catch {
      return errorRedirect('Failed to connect Google Drive');
    }
  });

  app.delete('/:id', requireWorkspaceGuard(), async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = getWorkspaceId(request);
    const env = loadEnv();

    const integration = await prisma.integrationAccount.findFirst({
      where: { id, workspaceId },
    });

    if (!integration) {
      return reply.status(404).send({ error: 'Integration not found' });
    }

    try {
      const adapter = getAdapter();
      const tokens = decryptTokens(
        integration.encryptedTokens,
        env.ENCRYPTION_KEY,
      );
      await adapter.revokeAccess(tokens);
    } catch {
      // best-effort revocation
    }

    await prisma.integrationAccount.deleteMany({ where: { id, workspaceId } });

    return { success: true };
  });
};
