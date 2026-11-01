import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import {
  isSessionValid,
  hasPermission,
  hasMinimumRole,
  hashToken,
  type MemberRole,
  type PermissionAction,
  type AuthenticatedUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@signalforge/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    sessionToken?: string;
  }
}

export { SESSION_COOKIE_NAME as SESSION_COOKIE };

export async function loadSession(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: {
            memberships: { include: { workspace: true } },
          },
        },
        activeWorkspace: true,
      },
    });

    if (!session || !isSessionValid(session.expiresAt)) return null;

    request.sessionToken = token;
    return session;
  } catch {
    return null;
  }
}

async function resolveActiveMembership(
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>,
) {
  const memberships = session.user.memberships;
  if (memberships.length === 0) return null;

  if (session.activeWorkspaceId) {
    const active = memberships.find((m) => m.workspaceId === session.activeWorkspaceId);
    if (active) return active;
  }

  const fallback = memberships[0]!;
  try {
    await prisma.session.update({
      where: { id: session.id },
      data: { activeWorkspaceId: fallback.workspaceId },
    });
  } catch {
    // Database unavailable — use in-memory fallback without persisting.
  }
  return fallback;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = await loadSession(request);
  if (!session) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const membership = await resolveActiveMembership(session);

  request.user = {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    workspaceId: membership?.workspaceId,
    role: membership?.role as MemberRole | undefined,
    sessionId: session.id,
  };
}

export async function authenticateOptional(
  request: FastifyRequest,
): Promise<void> {
  const session = await loadSession(request);
  if (!session) return;

  const membership = await resolveActiveMembership(session);
  request.user = {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    workspaceId: membership?.workspaceId,
    role: membership?.role as MemberRole | undefined,
    sessionId: session.id,
  };
}

export function requireAuth() {
  return { preHandler: authenticate };
}

export async function requireWorkspace(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  if (!request.user.workspaceId || !request.user.role) {
    return reply.status(403).send({ error: 'Workspace required' });
  }
}

export async function authenticateAndRequireWorkspace(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;
  await requireWorkspace(request, reply);
}

export function requireWorkspaceGuard() {
  return {
    preHandler: authenticateAndRequireWorkspace,
  };
}

/**
 * Accepts either the normal session cookie OR a short-lived signed upload token
 * sent as `Authorization: Bearer <token>`. Large uploads go directly to the API
 * origin (bypassing the Vercel proxy), where the web app's session cookie does
 * not exist; the token carries the same user/workspace identity.
 */
export function requireWorkspaceOrUploadToken() {
  return {
    preHandler: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const header = request.headers.authorization;
      const queryToken = (request.query as { uploadToken?: string } | undefined)?.uploadToken;
      const bearer = header?.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : queryToken; // query form supports plain <a href> downloads
      if (bearer) {
        const { verifyUploadToken } = await import('../upload-token.js');
        const payload = verifyUploadToken(bearer);
        if (!payload) {
          return reply.status(401).send({ error: 'Invalid or expired upload token' });
        }
        request.user = {
          userId: payload.userId,
          email: '',
          name: null,
          workspaceId: payload.workspaceId,
          role: payload.role as MemberRole,
          sessionId: '',
        };
        return;
      }
      await authenticateAndRequireWorkspace(request, reply);
    },
  };
}

export function requireWorkspaceRole(minimumRole: MemberRole) {
  return {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticateAndRequireWorkspace(request, reply);
      if (reply.sent) return;
      if (!request.user?.role || !hasMinimumRole(request.user.role, minimumRole)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    },
  };
}

export function requirePermission(action: PermissionAction) {
  return {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticateAndRequireWorkspace(request, reply);
      if (reply.sent) return;
      if (!request.user?.role || !hasPermission(request.user.role, action)) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    },
  };
}

function configuredCookieDomain(): string | undefined {
  const domain = loadEnv().SESSION_COOKIE_DOMAIN?.trim().replace(/^\./, '').toLowerCase();
  return domain || undefined;
}

/**
 * Domain to scope the session cookie to for this request, or undefined for a
 * host-only cookie.
 *
 * When the web app runs on a host inside SESSION_COOKIE_DOMAIN and calls the API
 * directly (app.websiterankerrs.tech → api.websiterankerrs.tech), a host-only
 * cookie would live on the API host only and never reach the web app's host,
 * whose Next.js middleware gates protected pages on it — so every page would
 * bounce back to /login after a successful login. Scoping to the shared parent
 * domain fixes that. Requests from any other origin (e.g. *.vercel.app going
 * through the same-origin /api proxy) keep a host-only cookie, which the browser
 * attributes to that proxy origin.
 */
export function sessionCookieDomain(request: FastifyRequest): string | undefined {
  const domain = configuredCookieDomain();
  const origin = request.headers.origin;
  if (!domain || !origin) return undefined;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return host === domain || host.endsWith(`.${domain}`) ? domain : undefined;
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  secure: boolean,
  request: FastifyRequest,
): void {
  const domain = sessionCookieDomain(request);
  if (domain) {
    // Drop any older host-only copy so the browser does not send two
    // sf_session cookies to the API host.
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...(domain ? { domain } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  // Also clear the domain-scoped variant. A browser ignores this when the
  // response comes from a host outside the domain, so it is always safe.
  const domain = configuredCookieDomain();
  if (domain) {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/', domain });
  }
}

export function getWorkspaceId(request: FastifyRequest): string {
  const workspaceId = request.user?.workspaceId;
  if (!workspaceId) {
    throw new Error('Workspace context missing after authorization');
  }
  return workspaceId;
}

export async function buildSessionResponse(userId: string, sessionToken: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: { workspace: true } },
    },
  });

  if (!user) return null;

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(sessionToken) } });

  const workspaces = user.memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role as MemberRole,
  }));

  const needsOnboarding = user.memberships.length === 0 || !user.onboardingCompletedAt;

  let activeWorkspace = null;
  let role: MemberRole | null = null;

  if (session?.activeWorkspaceId) {
    const membership = user.memberships.find((m) => m.workspaceId === session.activeWorkspaceId);
    if (membership) {
      activeWorkspace = {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role as MemberRole,
      };
      role = membership.role as MemberRole;
    }
  } else if (user.memberships[0]) {
    const m = user.memberships[0];
    activeWorkspace = {
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role as MemberRole,
    };
    role = m.role as MemberRole;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    },
    workspace: activeWorkspace,
    workspaces,
    role,
    needsOnboarding,
  };
}
