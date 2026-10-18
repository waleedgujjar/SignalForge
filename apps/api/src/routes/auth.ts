import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  createSessionExpiry,
  hashToken,
} from '@signalforge/auth';
import {
  loginSchema,
  signupSchema,
  sessionResponseSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailTokenSchema,
} from '@signalforge/validation';
import {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  buildSessionResponse,
  authenticateOptional,
} from '../plugins/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../system-email.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function createUserSession(userId: string, activeWorkspaceId?: string) {
  const rawToken = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: createSessionExpiry(),
      activeWorkspaceId,
    },
  });
  return { ...session, rawToken };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const env = loadEnv();

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      return reply.status(400).send({ error: 'Unable to create account' });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: hashPassword(body.password),
        name: body.name,
      },
    });

    const session = await createUserSession(user.id);
    setSessionCookie(reply, session.rawToken, env.NODE_ENV === 'production');

    const payload = await buildSessionResponse(user.id, session.rawToken);
    return sessionResponseSchema.parse(payload);
  });

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const env = loadEnv();

    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { memberships: true },
    });

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const activeWorkspaceId = user.memberships[0]?.workspaceId;
    const session = await createUserSession(user.id, activeWorkspaceId);
    setSessionCookie(reply, session.rawToken, env.NODE_ENV === 'production');

    const payload = await buildSessionResponse(user.id, session.rawToken);
    return sessionResponseSchema.parse(payload);
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/session', async (request, reply) => {
    try {
      await authenticateOptional(request);
      const token = request.cookies[SESSION_COOKIE];
      if (!token || !request.user) {
        clearSessionCookie(reply);
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const payload = await buildSessionResponse(request.user.userId, token);
      if (!payload) {
        clearSessionCookie(reply);
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      return sessionResponseSchema.parse(payload);
    } catch {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.post('/forgot-password', async (request) => {
    const body = forgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

    if (user) {
      const rawToken = generateSessionToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const sent = await sendPasswordResetEmail(user.email, rawToken);
      if (!sent) {
        request.log.warn('System SMTP not configured — password reset email not sent');
      }
    }

    return { ok: true };
  });

  app.post('/reset-password', async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const tokenHash = hashToken(body.token);

    const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'Invalid or expired reset token' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash: hashPassword(body.password) },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    return reply.send({ ok: true });
  });

  app.post('/request-verification', async (request, reply) => {
    await authenticateOptional(request);
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({ where: { id: request.user.userId } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const rawToken = generateSessionToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const sent = await sendVerificationEmail(user.email, rawToken);
    if (!sent) {
      request.log.warn('System SMTP not configured — verification email not sent');
    }

    return { ok: true };
  });

  app.post('/verify-email', async (request, reply) => {
    const body = verifyEmailTokenSchema.parse(request.body);
    const tokenHash = hashToken(body.token);

    const verificationToken = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'Invalid or expired verification token' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: verificationToken.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      prisma.emailVerificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { ok: true };
  });
};

export { slugify };
