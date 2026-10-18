import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '@signalforge/auth';

// ─── Environment ──────────────────────────────────────────────────────────────

const flags = { enabled: true };
vi.mock('@signalforge/config', () => {
  const env = () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
    LINKEDIN_RESEARCH_ENABLED: flags.enabled,
    LINKEDIN_RESEARCH_PROVIDER: 'public',
    LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED: true,
    LINKEDIN_RESEARCH_MAX_BATCH_SIZE: 50,
  });
  return { loadEnv: env, getEnv: env };
});

// ─── Sessions + leads (tenancy is enforced by the where-clause, mirrored here) ─

const sessions: Record<string, { userId: string; workspaceId: string; role: string }> = {
  [hashToken('tok-admin-ws1')]: { userId: 'u1', workspaceId: 'ws1', role: 'ADMIN' },
  [hashToken('tok-member-ws1')]: { userId: 'u2', workspaceId: 'ws1', role: 'MEMBER' },
  [hashToken('tok-admin-ws2')]: { userId: 'u3', workspaceId: 'ws2', role: 'ADMIN' },
};

const leads = [
  { id: 'lead-1', workspaceId: 'ws1', linkedinUrl: null, website: 'https://acme.test', companyDomain: 'acme.test', jobTitle: null, websiteAnalyses: [] },
  { id: 'lead-2', workspaceId: 'ws2', linkedinUrl: null, website: null, companyDomain: null, jobTitle: null, websiteAnalyses: [] },
];

const leadFindFirst = vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) =>
  leads.find((lead) => lead.id === where.id && lead.workspaceId === where.workspaceId) ?? null,
);

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
      update: vi.fn(async () => ({})),
    },
    lead: { findFirst: leadFindFirst },
  },
}));

// ─── Queue / events ───────────────────────────────────────────────────────────

const enqueue = vi.fn(async (..._args: unknown[]) => ({ id: 'job' }));
vi.mock('@signalforge/queue', () => ({
  QUEUE_NAMES: { LEAD_RESEARCH: 'lead-research', LEAD_ENRICHMENT: 'lead-enrichment' },
  createQueue: () => ({ add: vi.fn() }),
  createRedisConnection: () => ({}),
  DEFAULT_JOB_OPTIONS: {},
  enqueueLeadResearch: (...args: unknown[]) => enqueue(...args),
}));

const publish = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: (...args: unknown[]) => publish(...args),
}));

// ─── Research service (mocked); URL errors + stripSecrets come from the real module ──

const researchRows = new Map<string, Record<string, unknown>>();
researchRows.set('res-1', {
  id: 'res-1',
  workspaceId: 'ws1',
  leadId: 'lead-1',
  source: 'LINKEDIN',
  researchType: 'COMPANY',
  status: 'MANUAL_REVIEW',
  provider: 'public',
  confidence: null,
  provenance: [],
  rawData: { fetchedVia: 'jina-reader', cookie: 'li_at=AQEDAsecretsecretsecretsecret' },
  retryCount: 0,
});

const service = {
  getProviderConfigs: vi.fn(async () => []),
  resolveWorkspaceEnabled: vi.fn(() => () => true),
  buildProviderStatusEntries: vi.fn(() => [
    {
      provider: 'agent-reach',
      displayName: 'Agent-Reach',
      status: 'NEEDS_SETUP',
      authentication: 'NOT_CONFIGURED',
      checkedAt: null,
      details: ['doctor said li_at=AQEDAsecretsecretsecretsecret', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'],
      implemented: true,
      enabled: false,
      usage: null,
      apiToken: 'should-never-leak',
    },
  ]),
  recordHealthCheck: vi.fn(async () => ({})),
  upsertProviderConfig: vi.fn(async () => ({})),
  createResearchRequests: vi.fn(async (input: { workspaceId: string; leadId: string; companyUrl?: string; personUrl?: string }) => ({
    research: [
      { id: 'res-new', leadId: input.leadId, status: 'QUEUED', researchType: input.companyUrl ? 'COMPANY' : 'PERSON', retryCount: 0 },
    ],
    queued: 1,
    reused: 0,
  })),
  approvePending: vi.fn(async () => ({ rows: [], skipped: 0, capped: false })),
  listQueue: vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  getStats: vi.fn(async () => ({ total: 0, byStatus: {}, byType: {}, manualReviewCount: 0, pendingCount: 0, verifiedCount: 0, completedLast7Days: 0, providers: [] })),
  getLatestPerSource: vi.fn(async () => []),
  getUnifiedHistory: vi.fn(async () => []),
  getResearch: vi.fn(async (workspaceId: string, id: string) => {
    const row = researchRows.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }),
  applyManualVerification: vi.fn(async (input: { researchId: string; userId: string }) => ({
    ...researchRows.get(input.researchId)!,
    status: 'COMPLETED',
    provider: 'manual',
    confidence: 'HIGH',
    verifiedByUserId: input.userId,
    provenance: [{ field: 'company.name', value: 'Acme', source: 'MANUAL', verification: 'VERIFIED', confidence: 0.95 }],
  })),
  markVerified: vi.fn(),
  resetForRetry: vi.fn(async (input: { researchId: string }) => ({ ...researchRows.get(input.researchId)!, status: 'QUEUED' })),
};

const healthChecks = vi.fn(async (..._args: unknown[]) => [
  { provider: 'public', status: 'READY', authentication: 'NOT_REQUIRED', checkedAt: new Date().toISOString(), details: [] },
]);
const ensureEnrichment = vi.fn(async (..._args: unknown[]) => undefined);
const logActivity = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('@signalforge/lead-research', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@signalforge/lead-research')>();
  return {
    ...actual,
    isLinkedInResearchEnabled: () => flags.enabled,
    leadResearchService: service,
    runProviderHealthChecks: (...args: unknown[]) => healthChecks(...args),
    listProviders: () => [
      { provider: 'manual', displayName: 'Manual', implemented: true, configured: true },
      { provider: 'public', displayName: 'Public', implemented: true, configured: true },
      { provider: 'agent-reach', displayName: 'Agent-Reach', implemented: true, configured: false },
    ],
    selectProviderChain: () => [{ provider: 'public' }, { provider: 'manual' }],
    ensureEnrichmentQueued: (...args: unknown[]) => ensureEnrichment(...args),
    logResearchActivity: (...args: unknown[]) => logActivity(...args),
  };
});

async function buildTestApp() {
  const { leadResearchRoutes } = await import('./lead-research.js');
  const app = Fastify();
  await app.register(cookie);
  await app.register(leadResearchRoutes, { prefix: '/lead-research' });
  await app.ready();
  return app;
}

const as = (token: string) => ({ cookies: { sf_session: token } });
const SECRET_PATTERN = /should-never-leak|AQEDAsecretsecret|abcdefghijklmnopqrstuvwxyz0123456789/i;

describe('lead-research routes', () => {
  beforeEach(() => {
    flags.enabled = true;
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/lead-research/providers/status' });
    expect(res.statusCode).toBe(401);
  });

  it('reports disabled and refuses mutations while the flag is off', async () => {
    flags.enabled = false;
    const app = await buildTestApp();

    const status = await app.inject({ method: 'GET', url: '/lead-research/providers/status', ...as('tok-admin-ws1') });
    expect(status.json()).toEqual({ status: 'disabled' });

    const create = await app.inject({
      method: 'POST',
      url: '/lead-research/research',
      payload: { leadId: 'lead-1', companyUrl: 'https://www.linkedin.com/company/acme' },
      ...as('tok-admin-ws1'),
    });
    expect(create.statusCode).toBe(501);
    expect(service.createResearchRequests).not.toHaveBeenCalled();
  });

  it('never returns secret-looking values from provider status', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/lead-research/providers/status', ...as('tok-admin-ws1') });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; providers: Record<string, unknown>[] };
    expect(body.status).toBe('ok');
    expect(body.providers[0]).not.toHaveProperty('apiToken');
    expect(res.body).not.toMatch(SECRET_PATTERN);
  });

  it('denies cross-workspace access to a research record', async () => {
    const app = await buildTestApp();

    const other = await app.inject({ method: 'GET', url: '/lead-research/research/res-1', ...as('tok-admin-ws2') });
    expect(other.statusCode).toBe(404);
    expect(service.getResearch).toHaveBeenCalledWith('ws2', 'res-1');

    const own = await app.inject({ method: 'GET', url: '/lead-research/research/res-1', ...as('tok-admin-ws1') });
    expect(own.statusCode).toBe(200);
    expect(service.getResearch).toHaveBeenCalledWith('ws1', 'res-1');
    // rawData is returned to the owning workspace, but never with credential-like keys.
    expect(own.body).not.toMatch(/li_at|AQEDA/);
  });

  it('scopes queue, stats and per-lead reads to the caller workspace', async () => {
    const app = await buildTestApp();

    await app.inject({ method: 'GET', url: '/lead-research/queue?status=MANUAL_REVIEW', ...as('tok-admin-ws1') });
    expect(service.listQueue).toHaveBeenCalledWith('ws1', expect.objectContaining({ statuses: ['MANUAL_REVIEW'] }));

    await app.inject({ method: 'GET', url: '/lead-research/queue', ...as('tok-admin-ws1') });
    expect(service.listQueue).toHaveBeenLastCalledWith(
      'ws1',
      expect.objectContaining({ statuses: ['MANUAL_REVIEW', 'PENDING', 'FAILED', 'UNAVAILABLE'] }),
    );

    const foreignLead = await app.inject({ method: 'GET', url: '/lead-research/lead/lead-2', ...as('tok-admin-ws1') });
    expect(foreignLead.statusCode).toBe(404);
    expect(leadFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-2', workspaceId: 'ws1' } }));
  });

  it('creates research for validated LinkedIn URLs and enqueues queued rows', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lead-research/research',
      payload: { leadId: 'lead-1', companyUrl: 'https://uk.linkedin.com/company/Acme/?trk=x' },
      ...as('tok-member-ws1'),
    });

    expect(res.statusCode).toBe(202);
    expect(service.createResearchRequests).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', leadId: 'lead-1', requestedByUserId: 'u2' }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws1', leadId: 'lead-1', researchId: 'res-new' }),
    );
  });

  it('rejects non-LinkedIn hosts with 400 and wrong URL kinds with 422', async () => {
    const app = await buildTestApp();

    const badHost = await app.inject({
      method: 'POST',
      url: '/lead-research/research',
      payload: { leadId: 'lead-1', companyUrl: 'https://lnkd.in/abc' },
      ...as('tok-admin-ws1'),
    });
    expect(badHost.statusCode).toBe(400);

    const actual = await vi.importActual<typeof import('@signalforge/lead-research')>('@signalforge/lead-research');
    service.createResearchRequests.mockRejectedValueOnce(
      new actual.LinkedInUrlError('UNSUPPORTED_URL', 'companyUrl must be a LinkedIn company page'),
    );
    const wrongKind = await app.inject({
      method: 'POST',
      url: '/lead-research/research',
      payload: { leadId: 'lead-1', companyUrl: 'https://www.linkedin.com/in/jane-doe' },
      ...as('tok-admin-ws1'),
    });
    expect(wrongKind.statusCode).toBe(422);
    expect(wrongKind.json()).toMatchObject({ code: 'UNSUPPORTED_URL' });
  });

  it('saves manual verification with the caller as verifier and re-queues enrichment', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lead-research/research/res-1/verify',
      payload: { company: { name: 'Acme', employeeRange: '11-50 employees' }, signals: { hiring: true } },
      ...as('tok-member-ws1'),
    });

    expect(res.statusCode).toBe(200);
    expect(service.applyManualVerification).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', researchId: 'res-1', userId: 'u2' }),
    );
    const body = res.json() as { status: string; provenance: { verification: string; source: string }[] };
    expect(body.status).toBe('COMPLETED');
    expect(body.provenance.every((p) => p.verification === 'VERIFIED' && p.source === 'MANUAL')).toBe(true);
    expect(ensureEnrichment).toHaveBeenCalledWith('ws1', 'lead-1');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'lead-research-verified:res-1' }));
  });

  it('restricts provider health checks and toggles to admins', async () => {
    const app = await buildTestApp();

    const member = await app.inject({ method: 'POST', url: '/lead-research/providers/health-check', payload: {}, ...as('tok-member-ws1') });
    expect(member.statusCode).toBe(403);
    expect(healthChecks).not.toHaveBeenCalled();

    const admin = await app.inject({ method: 'POST', url: '/lead-research/providers/health-check', payload: {}, ...as('tok-admin-ws1') });
    expect(admin.statusCode).toBe(200);
    expect(service.recordHealthCheck).toHaveBeenCalledWith('ws1', 'LINKEDIN', expect.objectContaining({ provider: 'public' }));
    expect(admin.body).not.toMatch(SECRET_PATTERN);

    const disableManual = await app.inject({
      method: 'PUT',
      url: '/lead-research/providers',
      payload: { provider: 'manual', enabled: false },
      ...as('tok-admin-ws1'),
    });
    expect(disableManual.statusCode).toBe(400);
    expect(service.upsertProviderConfig).not.toHaveBeenCalled();
  });

  it('retries with a fresh job id', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/lead-research/research/res-1/retry', ...as('tok-admin-ws1') });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ researchId: 'res-1', status: 'QUEUED' });
    const options = enqueue.mock.calls[0]?.[2] as { jobId?: string } | undefined;
    expect(options?.jobId).toMatch(/^lead-research-res-1-retry-\d+$/);
  });
});
