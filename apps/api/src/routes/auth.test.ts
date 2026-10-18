import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockUsers: Map<
  string,
  {
    id: string;
    email: string;
    passwordHash: string;
    name: string | null;
    emailVerifiedAt: Date | null;
    onboardingCompletedAt: Date | null;
    memberships: {
      workspaceId: string;
      role: string;
      workspace: { id: string; name: string; slug: string };
    }[];
  }
> = new Map();

const mockSessions: Map<
  string,
  {
    id: string;
    userId: string;
    tokenHash: string;
    activeWorkspaceId: string | null;
    expiresAt: Date;
  }
> = new Map();

const mockWorkspaces: Map<string, { id: string; name: string; slug: string }> = new Map();
const mockMembers: { workspaceId: string; userId: string; role: string }[] = [];

function getUserByEmail(email: string) {
  return [...mockUsers.values()].find((u) => u.email === email) ?? null;
}

vi.mock('@signalforge/config', () => {
  const env = () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
  });
  return { loadEnv: env, getEnv: env };
});

vi.mock('@signalforge/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) return getUserByEmail(where.email);
        if (where.id) return mockUsers.get(where.id) ?? null;
        return null;
      }),
      create: vi.fn(
        async ({ data }: { data: { email: string; passwordHash: string; name: string } }) => {
          const id = `user_${mockUsers.size + 1}`;
          const user = {
            id,
            email: data.email,
            passwordHash: data.passwordHash,
            name: data.name,
            emailVerifiedAt: null,
            onboardingCompletedAt: null,
            memberships: [] as {
              workspaceId: string;
              role: string;
              workspace: { id: string; name: string; slug: string };
            }[],
          };
          mockUsers.set(id, user);
          return user;
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = mockUsers.get(where.id)!;
        Object.assign(user, data);
        return user;
      }),
    },
    session: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { userId: string; tokenHash: string; expiresAt: Date; activeWorkspaceId?: string };
        }) => {
          const session = {
            id: `sess_${mockSessions.size + 1}`,
            ...data,
            activeWorkspaceId: data.activeWorkspaceId ?? null,
          };
          mockSessions.set(data.tokenHash, session);
          return session;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const session = mockSessions.get(where.tokenHash);
        if (!session) return null;
        const user = mockUsers.get(session.userId);
        return {
          ...session,
          user: user
            ? {
                ...user,
                memberships: user.memberships.map((m) => ({
                  ...m,
                  workspaceId: m.workspaceId,
                  role: m.role,
                  workspace: m.workspace,
                })),
              }
            : undefined,
          activeWorkspace: session.activeWorkspaceId
            ? mockWorkspaces.get(session.activeWorkspaceId) ?? null
            : null,
        };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tokenHash?: string; userId?: string } }) => {
        if (where.tokenHash) {
          mockSessions.delete(where.tokenHash);
        }
        return { count: 1 };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { tokenHash: string };
          data: { activeWorkspaceId: string };
        }) => {
          const session = mockSessions.get(where.tokenHash);
          if (session) session.activeWorkspaceId = data.activeWorkspaceId;
          return { count: 1 };
        },
      ),
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return [...mockWorkspaces.values()].find((w) => w.slug === where.slug) ?? null;
      }),
      create: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        return mockMembers
          .filter((m) => m.userId === where.userId)
          .map((m) => ({
            ...m,
            workspace: mockWorkspaces.get(m.workspaceId)!,
            createdAt: new Date(),
          }));
      }),
      findUnique: vi.fn(),
    },
    passwordResetToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    emailVerificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          workspace: {
            create: async ({
              data,
            }: {
              data: {
                name: string;
                slug: string;
                members: { create: { userId: string; role: string } };
              };
            }) => {
              const id = `ws_${mockWorkspaces.size + 1}`;
              const workspace = { id, name: data.name, slug: data.slug };
              mockWorkspaces.set(id, workspace);
              mockMembers.push({
                workspaceId: id,
                userId: data.members.create.userId,
                role: data.members.create.role,
              });
              const user = mockUsers.get(data.members.create.userId);
              if (user) {
                user.memberships.push({ workspaceId: id, role: 'OWNER', workspace });
                user.onboardingCompletedAt = new Date();
              }
              return workspace;
            },
          },
          user: {
            update: async ({ where }: { where: { id: string } }) => {
              const user = mockUsers.get(where.id)!;
              user.onboardingCompletedAt = new Date();
              return user;
            },
          },
        });
      }
      if (Array.isArray(arg)) {
        for (const op of arg) await op;
      }
      return undefined;
    }),
  },
}));

describe('auth routes', () => {
  beforeEach(() => {
    mockUsers.clear();
    mockSessions.clear();
    mockWorkspaces.clear();
    mockMembers.length = 0;
    vi.clearAllMocks();
  });

  it('signup creates user only and returns needsOnboarding', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password1',
        confirmPassword: 'Password1',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.needsOnboarding).toBe(true);
    expect(body.user.email).toBe('test@example.com');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(response.cookies).toHaveLength(1);
  });

  it('rejects duplicate signup with generic error', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const payload = {
      name: 'Test User',
      email: 'dup@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
    };

    await app.inject({ method: 'POST', url: '/auth/signup', payload });
    const response = await app.inject({ method: 'POST', url: '/auth/signup', payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Unable to create account');
  });

  it('login rejects invalid credentials', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'missing@example.com', password: 'Password1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid credentials');
  });

  it('logout invalidates session cookie', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: 'Logout User',
        email: 'logout@example.com',
        password: 'Password1',
        confirmPassword: 'Password1',
      },
    });

    const cookie = signup.cookies.find((c) => c.name === 'sf_session')!;
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { sf_session: cookie.value },
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json().ok).toBe(true);
  });
});

describe('workspace routes', () => {
  beforeEach(() => {
    mockUsers.clear();
    mockSessions.clear();
    mockWorkspaces.clear();
    mockMembers.length = 0;
    vi.clearAllMocks();
  });

  it('onboarding creates workspace and owner membership', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        name: 'Owner User',
        email: 'owner@example.com',
        password: 'Password1',
        confirmPassword: 'Password1',
      },
    });

    const cookie = signup.cookies.find((c) => c.name === 'sf_session')!;

    const response = await app.inject({
      method: 'POST',
      url: '/workspaces/onboarding',
      payload: { workspaceName: 'Acme Sales', primaryUseCase: 'COLD_EMAIL' },
      cookies: { sf_session: cookie.value },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.needsOnboarding).toBe(false);
    expect(body.workspace?.name).toBe('Acme Sales');
    expect(body.role).toBe('OWNER');
  });
});
