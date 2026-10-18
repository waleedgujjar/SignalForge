import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hashToken } from '@signalforge/auth';
import { encryptSecret, decryptSecret } from '@signalforge/email';

// ─── Mock session store ──────────────────────────────────────────────────────

const sessions: Record<string, { userId: string; workspaceId: string; role: string }> = {
  [hashToken('tok-admin-ws1')]: { userId: 'u1', workspaceId: 'ws1', role: 'ADMIN' },
  [hashToken('tok-member-ws1')]: { userId: 'u2', workspaceId: 'ws1', role: 'MEMBER' },
  [hashToken('tok-admin-ws2')]: { userId: 'u3', workspaceId: 'ws2', role: 'ADMIN' },
};

vi.mock('@signalforge/config', () => {
  const env = () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    SESSION_SECRET: 'test-secret',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    REDIS_URL: 'redis://localhost:6380',
    ENCRYPTION_KEY: 'test-encryption-key-32-characters!',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'http://localhost:11434',
    OPENAI_MODEL: 'test-model',
  });
  return { loadEnv: env, getEnv: env };
});

vi.mock('@signalforge/database', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const entry = sessions[where.tokenHash];
        if (!entry) return null;
        return {
          id: `session-${entry.userId}`,
          tokenHash: where.tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          activeWorkspaceId: entry.workspaceId,
          user: {
            id: entry.userId,
            email: `${entry.userId}@example.test`,
            name: entry.userId,
            memberships: [
              {
                workspaceId: entry.workspaceId,
                role: entry.role,
                workspace: { id: entry.workspaceId, name: entry.workspaceId },
              },
            ],
          },
          activeWorkspace: { id: entry.workspaceId, name: entry.workspaceId },
        };
      }),
      update: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (where.workspaceId === 'ws1' && where.id === 'lead1') return { id: 'lead1', workspaceId: 'ws1' };
        return null;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (where.workspaceId === 'ws1' && where.id === 'lead1') return { count: 1 };
        return { count: 0 };
      }),
    },
    suppression: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (where.workspaceId === 'ws1') return { count: 1 };
        return { count: 0 };
      }),
    },
    tag: {
      deleteMany: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (where.workspaceId === 'ws1') return { count: 1 };
        return { count: 0 };
      }),
    },
  },
  checkDatabaseConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));

vi.mock('@signalforge/queue', () => ({
  QUEUE_NAMES: {},
  checkRedisConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  createQueue: vi.fn(() => ({ getJobCounts: vi.fn(async () => ({})), close: vi.fn() })),
  createRedisConnection: vi.fn(),
}));

vi.mock('@signalforge/ai', () => ({
  checkAIHealth: vi.fn(() => ({ ok: true, provider: 'test' })),
  createAIProvider: vi.fn(() => ({})),
}));

vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@signalforge/verification', () => ({
  verificationJobService: { enqueueVerification: vi.fn() },
}));

vi.mock('@signalforge/lead-research', () => ({
  isLinkedInResearchEnabled: vi.fn(() => false),
  isWebResearchEnabled: vi.fn(() => false),
  leadResearchService: {},
}));

vi.mock('@signalforge/lead-discovery', () => ({
  discoveryService: {},
  leadDiscoveryService: {},
}));

vi.mock('@signalforge/integrations', () => ({
  GoogleDriveAdapter: vi.fn(),
}));

vi.mock('@signalforge/campaigns', () => ({
  campaignService: {},
}));

vi.mock('@signalforge/lead-enrichment', () => ({
  leadEnrichmentService: {},
}));

vi.mock('@signalforge/allocation', () => ({
  smtpPoolService: { listPools: vi.fn(async () => []) },
}));

vi.mock('@signalforge/website-scanner', () => ({
  websiteIntelligenceService: {},
}));

const as = (token: string) => ({ cookies: { sf_session: token } });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('security: error sanitization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns generic error for unhandled exceptions (no stack leak)', async () => {
    const { prisma } = await import('@signalforge/database');
    (prisma.suppression.findMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );

    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/suppressions',
      query: {},
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('returns 400 with issues for Zod validation errors', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/suppressions',
      payload: { type: 'INVALID_TYPE', value: '' },
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Validation failed');
    expect(body).toHaveProperty('issues');
  });
});

describe('security: health endpoint auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows unauthenticated access to /health', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('rejects unauthenticated access to /health/db', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated access to /health/redis', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health/redis' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated access to /health/ai', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health/ai' });
    expect(res.statusCode).toBe(401);
  });
});

describe('security: workspace isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when accessing lead from wrong workspace', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/leads/lead1',
      ...as('tok-admin-ws2'),
    });

    expect(res.statusCode).toBe(404);
  });

  it('allows accessing lead from correct workspace', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/leads/lead1',
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(204);
  });
});

describe('security: input validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects CSV import with empty rows', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/leads/import',
      payload: { rows: [], mappings: {} },
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects tag assignment with empty tagIds', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/leads/lead1/tags',
      payload: { tagIds: [] },
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects list member add with empty leadIds', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/leads/lists/list1/members',
      payload: { leadIds: [] },
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects suppression query with invalid type', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/suppressions',
      query: { type: 'INVALID' },
      ...as('tok-admin-ws1'),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('security: session token hashing', () => {
  it('hashToken produces consistent SHA-256 output', () => {
    const hash1 = hashToken('test-token');
    const hash2 = hashToken('test-token');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe('test-token');
    expect(hash1).toHaveLength(64);
  });

  it('different tokens produce different hashes', () => {
    const hash1 = hashToken('token-a');
    const hash2 = hashToken('token-b');
    expect(hash1).not.toBe(hash2);
  });
});

describe('security: encryption KDF', () => {
  it('encrypts and decrypts with new KDF', () => {
    const key = 'a-strong-encryption-key-for-tests';
    const { encryptedPayload } = encryptSecret('my-secret', key);
    expect(decryptSecret(encryptedPayload, key)).toBe('my-secret');
  });

  it('encrypted payload does not contain plaintext', () => {
    const key = 'another-test-key-with-enough-chars';
    const { encryptedPayload } = encryptSecret('super-secret-password', key);
    expect(encryptedPayload).not.toContain('super-secret-password');
  });
});

describe('security: unauthenticated access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unauthenticated requests to protected routes', async () => {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    const routes = [
      { method: 'GET' as const, url: '/leads' },
      { method: 'GET' as const, url: '/suppressions' },
      { method: 'GET' as const, url: '/mailboxes' },
      { method: 'GET' as const, url: '/campaigns' },
    ];

    for (const route of routes) {
      const res = await app.inject(route);
      expect(res.statusCode).toBe(401);
    }
  });
});
