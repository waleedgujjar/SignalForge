import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '@signalforge/auth';

// ─── Environment ──────────────────────────────────────────────────────────────

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
  }),
}));

// ─── Sessions (multi-tenant) ─────────────────────────────────────────────────

const sessions: Record<string, { userId: string; workspaceId: string; role: string }> = {
  [hashToken('tok-admin-ws1')]: { userId: 'u1', workspaceId: 'ws1', role: 'ADMIN' },
  [hashToken('tok-member-ws1')]: { userId: 'u2', workspaceId: 'ws1', role: 'MEMBER' },
  [hashToken('tok-admin-ws2')]: { userId: 'u3', workspaceId: 'ws2', role: 'ADMIN' },
};

// ─── In-memory data stores ───────────────────────────────────────────────────

const jobs = new Map<string, Record<string, unknown>>();
const discoveredLeads = new Map<string, Record<string, unknown>>();
const activities: Record<string, unknown>[] = [];

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    workspaceId: 'ws1',
    initiatedByUserId: 'u1',
    source: 'GOOGLE_MAPS_SCRAPER',
    status: 'COMPLETED',
    name: 'HVAC Houston',
    query: { keywords: ['HVAC'], city: 'Houston', state: 'Texas', maxResults: 50 },
    filters: { minScore: 0 },
    requestedCount: 50,
    discoveredCount: 10,
    uniqueCount: 8,
    duplicateCount: 2,
    enrichedCount: 0,
    websiteAnalyzedCount: 0,
    emailsFoundCount: 5,
    emailsVerifiedCount: 3,
    qualifiedCount: 6,
    promotedCount: 0,
    failedCount: 1,
    error: null,
    errorLog: [],
    metadata: {},
    startedAt: new Date('2026-10-01T10:00:00Z'),
    completedAt: new Date('2026-10-01T10:05:00Z'),
    createdAt: new Date('2026-10-01T09:59:00Z'),
    updatedAt: new Date('2026-10-01T10:05:00Z'),
    ...overrides,
  };
}

function makeLead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dl-1',
    workspaceId: 'ws1',
    jobId: 'job-1',
    stage: 'QUALIFIED',
    isDuplicate: false,
    matchReason: null,
    rawCompany: 'Acme HVAC LLC',
    rawEmail: 'info@acmehvac.com',
    rawPhone: '(713) 555-0100',
    rawWebsite: 'https://acmehvac.com',
    company: 'Acme HVAC',
    normalizedCompany: 'acme hvac',
    firstName: 'John',
    lastName: 'Smith',
    fullName: 'John Smith',
    jobTitle: 'Owner',
    email: 'info@acmehvac.com',
    normalizedEmail: 'info@acmehvac.com',
    phone: '+17135550100',
    normalizedPhone: '+17135550100',
    website: 'https://acmehvac.com',
    normalizedDomain: 'acmehvac.com',
    industry: 'HVAC',
    countryCode: 'US',
    country: 'United States',
    state: 'Texas',
    city: 'Houston',
    postalCode: '77001',
    employeeCount: null,
    source: 'GOOGLE_MAPS_SCRAPER',
    sourceId: 'ChIJxyz',
    sourceUrl: null,
    discoveredAt: new Date('2026-10-01T10:01:00Z'),
    emailSource: 'SOURCE_PROVIDED',
    emailConfidence: 100,
    emailStatus: 'VERIFIED',
    emailScore: 100,
    websiteScore: null,
    opportunityScore: null,
    websiteAnalysis: null,
    aiOpportunity: null,
    aiResearch: null,
    icpFitScore: 85,
    icpBreakdown: { industry: 100, location: 100, companySize: 50, jobTitle: 100, seniority: 80 },
    qualified: true,
    qualifyReason: 'Lead meets ICP criteria',
    qualificationVersion: 'v1',
    qualificationSignals: [
      { code: 'INDUSTRY_MATCH', dimension: 'industry', status: 'MATCH', score: 100 },
      { code: 'LOCATION_MATCH', dimension: 'location', status: 'MATCH', score: 100 },
    ],
    promotedLeadId: null,
    errorMessage: null,
    metadata: {},
    createdAt: new Date('2026-10-01T10:01:00Z'),
    updatedAt: new Date('2026-10-01T10:01:00Z'),
    ...overrides,
  };
}

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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
    leadDiscoveryJob: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `job-${Date.now()}`;
        const job = makeJob({ ...data, id, status: 'PENDING', completedAt: null, startedAt: null });
        jobs.set(id, job);
        return job;
      }),
      findFirst: vi.fn(async ({ where, select }: { where: { id: string; workspaceId: string }; select?: Record<string, boolean> }) => {
        const job = jobs.get(where.id);
        if (!job || job.workspaceId !== where.workspaceId) return null;
        if (select) {
          const result: Record<string, unknown> = {};
          for (const key of Object.keys(select)) result[key] = job[key];
          return result;
        }
        return job;
      }),
      findMany: vi.fn(async ({ where, skip, take }: { where: Record<string, unknown>; orderBy?: unknown; skip?: number; take?: number }) => {
        let results = [...jobs.values()].filter((j) => j.workspaceId === where.workspaceId);
        if (where.status) results = results.filter((j) => j.status === where.status);
        if (where.source) results = results.filter((j) => j.source === where.source);
        results.sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
        return results.slice(skip ?? 0, (skip ?? 0) + (take ?? 20));
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let results = [...jobs.values()].filter((j) => j.workspaceId === where.workspaceId);
        if (where.status) results = results.filter((j) => j.status === where.status);
        if (where.source) results = results.filter((j) => j.source === where.source);
        return results.length;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = jobs.get(where.id);
        if (!existing) return null;
        const updated = { ...existing, ...data };
        jobs.set(where.id, updated);
        return updated;
      }),
    },
    discoveredLead: {
      findMany: vi.fn(async ({ where, skip, take }: { where: Record<string, unknown>; orderBy?: unknown; skip?: number; take?: number }) => {
        let results = [...discoveredLeads.values()].filter(
          (l) => l.workspaceId === where.workspaceId && l.jobId === where.jobId,
        );
        if (where.qualified !== undefined) results = results.filter((l) => l.qualified === where.qualified);
        if (where.isDuplicate !== undefined) results = results.filter((l) => l.isDuplicate === where.isDuplicate);
        if (where.emailStatus) results = results.filter((l) => l.emailStatus === where.emailStatus);
        if (where.state) results = results.filter((l) => l.state === where.state);
        if (where.normalizedEmail !== undefined) {
          if (where.normalizedEmail === null) results = results.filter((l) => l.normalizedEmail == null);
          else results = results.filter((l) => l.normalizedEmail != null);
        }
        if (where.normalizedDomain !== undefined) {
          if (where.normalizedDomain === null) results = results.filter((l) => l.normalizedDomain == null);
          else results = results.filter((l) => l.normalizedDomain != null);
        }
        if (where.normalizedPhone !== undefined) {
          if (where.normalizedPhone === null) results = results.filter((l) => l.normalizedPhone == null);
          else results = results.filter((l) => l.normalizedPhone != null);
        }
        if (where.icpFitScore && typeof where.icpFitScore === 'object' && 'gte' in where.icpFitScore) {
          results = results.filter((l) => (l.icpFitScore as number) >= (where.icpFitScore as { gte: number }).gte);
        }
        return results.slice(skip ?? 0, (skip ?? 0) + (take ?? 25));
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let results = [...discoveredLeads.values()].filter(
          (l) => l.workspaceId === where.workspaceId && l.jobId === where.jobId,
        );
        if (where.qualified !== undefined) results = results.filter((l) => l.qualified === where.qualified);
        if (where.emailStatus) results = results.filter((l) => l.emailStatus === where.emailStatus);
        if (where.state) results = results.filter((l) => l.state === where.state);
        if (where.normalizedEmail !== undefined) {
          if (where.normalizedEmail === null) results = results.filter((l) => l.normalizedEmail == null);
          else results = results.filter((l) => l.normalizedEmail != null);
        }
        return results.length;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    leadDiscoveryActivity: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `act-${activities.length + 1}`, createdAt: new Date(), ...data };
        activities.push(entry);
        return entry;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return activities.filter((a) => a.workspaceId === where.workspaceId && a.jobId === where.jobId);
      }),
    },
    leadSourceConfig: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown>; update: Record<string, unknown>; where: unknown }) => create),
    },
    campaign: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

// ─── Queue mock ──────────────────────────────────────────────────────────────

const enqueue = vi.fn(async (..._args: unknown[]) => ({ id: 'bullmq-job-1' }));

vi.mock('@signalforge/queue', () => ({
  QUEUE_NAMES: { LEAD_DISCOVERY: 'lead-discovery' },
  createQueue: () => ({ add: vi.fn() }),
  createRedisConnection: () => ({}),
  enqueueLeadDiscovery: (...args: unknown[]) => enqueue(...args),
}));

// ─── Lead-discovery service mocks ────────────────────────────────────────────

const promoteLeads = vi.fn(async (..._args: unknown[]) => ({
  promoted: 1,
  created: 1,
  updated: 0,
  skipped: [],
  leadIds: ['lead-001'],
}));

const requalify = vi.fn(async (..._args: unknown[]) => ({
  requalified: 5,
  newlyQualified: 1,
  newlyDisqualified: 0,
  unchanged: 4,
}));

const logActivity = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock('@signalforge/lead-discovery', () => ({
  listSources: () => [
    { source: 'GOOGLE_MAPS_SCRAPER', name: 'Google Maps (self-hosted scraper)', billable: false, fileBased: false },
    { source: 'CSV', name: 'CSV Import', billable: false, fileBased: true },
    { source: 'XLSX', name: 'Excel Import', billable: false, fileBased: true },
  ],
  isFileBased: (source: string) => ['CSV', 'XLSX'].includes(source),
  promoteDiscoveredLeads: (...args: unknown[]) => promoteLeads(...args),
  requalifyLeads: (...args: unknown[]) => requalify(...args),
  logDiscoveryActivity: (...args: unknown[]) => logActivity(...args),
  toCsv: () => 'col1,col2\nval1,val2',
  toXlsx: async () => Buffer.from('xlsx-stub'),
  DISCOVERED_LEAD_EXPORT_COLUMNS: [],
  AdapterNotConfiguredError: class extends Error { constructor(msg: string) { super(msg); this.name = 'AdapterNotConfiguredError'; } },
  AdapterNotAvailableError: class extends Error { constructor(msg: string) { super(msg); this.name = 'AdapterNotAvailableError'; } },
  InvalidDiscoveryRequestError: class extends Error { constructor(msg: string) { super(msg); this.name = 'InvalidDiscoveryRequestError'; } },
}));

// ─── Integrations mock ───────────────────────────────────────────────────────

vi.mock('@signalforge/integrations', () => ({
  parseFileStream: vi.fn(async () => ({ headers: ['company', 'email'], rows: [['Acme', 'a@b.com']], totalRowCount: 1 })),
  detectLeadImportMappings: vi.fn(() => ({ mappings: {}, unmappedColumns: [] })),
  buildLeadImportMappingsRecord: vi.fn(() => ({})),
}));

// ─── Campaigns mock ──────────────────────────────────────────────────────────

vi.mock('@signalforge/campaigns', () => ({
  campaignLeadService: {
    enrollLeads: vi.fn(async () => ({ enrolled: 0, skipped: 0 })),
  },
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

async function buildTestApp() {
  const { leadDiscoveryRoutes } = await import('./lead-discovery.js');
  const app = Fastify();
  await app.register(cookie);
  await app.register(leadDiscoveryRoutes, { prefix: '/lead-discovery' });
  await app.ready();
  return app;
}

const as = (token: string) => ({ cookies: { sf_session: token } });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('lead-discovery routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.clear();
    discoveredLeads.clear();
    activities.length = 0;
  });

  // ── Authentication ───────────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects unauthenticated requests', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Sources ──────────────────────────────────────────────────────────────

  describe('GET /sources', () => {
    it('lists discovery sources with config', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/sources', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
      expect(body.data[0]).toHaveProperty('source');
      expect(body.data[0]).toHaveProperty('enabled');
    });
  });

  describe('PUT /sources', () => {
    it('requires ADMIN role', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as('tok-member-ws1'),
      });
      expect(res.statusCode).toBe(403);
    });

    it('enables a source for admin', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/lead-discovery/sources',
        payload: { source: 'GOOGLE_MAPS_SCRAPER', enabled: true },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Job Creation ─────────────────────────────────────────────────────────

  describe('POST /jobs', () => {
    it('creates a job and returns 202 with jobId', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          name: 'HVAC Houston',
          query: { keywords: ['HVAC contractors'], city: 'Houston', state: 'Texas', maxResults: 50 },
        },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body).toHaveProperty('jobId');
      expect(body.status).toBe('PENDING');
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('rejects missing source', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: { query: { keywords: ['test'], maxResults: 10 } },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects maxResults above 500', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          query: { keywords: ['test'], maxResults: 1000 },
        },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects maxResults of 0', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          query: { keywords: ['test'], maxResults: 0 },
        },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects file-based source without file', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'CSV',
          query: { maxResults: 50 },
        },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('file is required');
    });

    it('rejects unauthenticated request', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          query: { keywords: ['test'], maxResults: 10 },
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('passes correct workspace context to enqueue', async () => {
      const app = await buildTestApp();
      await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs',
        payload: {
          source: 'GOOGLE_MAPS_SCRAPER',
          query: { keywords: ['plumbers'], city: 'Dallas', maxResults: 25 },
        },
        ...as('tok-admin-ws1'),
      });
      expect(enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workspaceId: 'ws1' }),
      );
    });
  });

  // ── Job Status ───────────────────────────────────────────────────────────

  describe('GET /jobs/:id', () => {
    it('returns a job from the authenticated workspace', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-1', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('job-1');
      expect(body).toHaveProperty('discoveredCount');
      expect(body).toHaveProperty('qualifiedCount');
      expect(body).toHaveProperty('status');
    });

    it('returns 404 for unknown job', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/nonexistent', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when accessing another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-ws2', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Job History ──────────────────────────────────────────────────────────

  describe('GET /jobs', () => {
    it('returns paginated jobs sorted by createdAt desc', async () => {
      jobs.set('job-a', makeJob({ id: 'job-a', createdAt: new Date('2026-10-01') }));
      jobs.set('job-b', makeJob({ id: 'job-b', createdAt: new Date('2026-10-02') }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.pagination).toHaveProperty('page');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('total');
      expect(body.pagination).toHaveProperty('totalPages');
    });

    it('filters by status', async () => {
      jobs.set('job-c', makeJob({ id: 'job-c', status: 'COMPLETED' }));
      jobs.set('job-f', makeJob({ id: 'job-f', status: 'FAILED' }));
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs?status=COMPLETED',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((j: { status: string }) => j.status === 'COMPLETED')).toBe(true);
    });

    it('filters by source', async () => {
      jobs.set('job-gm', makeJob({ id: 'job-gm', source: 'GOOGLE_MAPS_SCRAPER' }));
      jobs.set('job-csv', makeJob({ id: 'job-csv', source: 'CSV' }));
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs?source=CSV',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((j: { source: string }) => j.source === 'CSV')).toBe(true);
    });

    it('only returns jobs from authenticated workspace', async () => {
      jobs.set('job-ws1', makeJob({ id: 'job-ws1', workspaceId: 'ws1' }));
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs', ...as('tok-admin-ws1') });
      const body = res.json();
      expect(body.data.every((j: { workspaceId: string }) => j.workspaceId === 'ws1')).toBe(true);
    });
  });

  // ── Results ──────────────────────────────────────────────────────────────

  describe('GET /jobs/:id/results', () => {
    beforeEach(() => {
      jobs.set('job-1', makeJob());
      discoveredLeads.set('dl-1', makeLead());
      discoveredLeads.set('dl-2', makeLead({
        id: 'dl-2',
        company: 'No-Email Co',
        email: null,
        normalizedEmail: null,
        emailStatus: null,
        qualified: false,
        icpFitScore: 30,
        state: 'California',
      }));
      discoveredLeads.set('dl-3', makeLead({
        id: 'dl-3',
        company: 'Risky Email Co',
        emailStatus: 'RISKY',
        qualified: true,
        icpFitScore: 70,
        state: 'Texas',
      }));
    });

    it('returns paginated results with correct envelope', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-1/results', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('page', 1);
      expect(body.pagination).toHaveProperty('total');
      expect(body.pagination).toHaveProperty('totalPages');
    });

    it('filters by qualified=true', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?qualified=true',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((l: { qualified: boolean }) => l.qualified === true)).toBe(true);
    });

    it('filters by hasEmail=true', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?hasEmail=true',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((l: { normalizedEmail: string | null }) => l.normalizedEmail != null)).toBe(true);
    });

    it('filters by emailStatus', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?emailStatus=VERIFIED',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((l: { emailStatus: string }) => l.emailStatus === 'VERIFIED')).toBe(true);
    });

    it('filters by state', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?state=Texas',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((l: { state: string }) => l.state === 'Texas')).toBe(true);
    });

    it('filters by minScore', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?minScore=80',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((l: { icpFitScore: number }) => l.icpFitScore >= 80)).toBe(true);
    });

    it('returns empty results for valid empty job', async () => {
      jobs.set('job-empty', makeJob({ id: 'job-empty', discoveredCount: 0 }));
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-empty/results',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('returns 404 for other workspace job results', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-ws2/results',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns qualification fields in results', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results',
        ...as('tok-admin-ws1'),
      });
      const body = res.json();
      const lead = body.data[0];
      expect(lead).toHaveProperty('icpFitScore');
      expect(lead).toHaveProperty('qualified');
      expect(lead).toHaveProperty('qualifyReason');
      expect(lead).toHaveProperty('qualificationVersion');
      expect(lead).toHaveProperty('qualificationSignals');
    });

    it('returns email intelligence fields', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results',
        ...as('tok-admin-ws1'),
      });
      const body = res.json();
      const lead = body.data[0];
      expect(lead).toHaveProperty('emailStatus');
      expect(lead).toHaveProperty('emailScore');
      expect(lead).toHaveProperty('emailSource');
    });
  });

  // ── Cancellation ─────────────────────────────────────────────────────────

  describe('POST /jobs/:id/cancel', () => {
    it('cancels a PENDING job', async () => {
      jobs.set('job-p', makeJob({ id: 'job-p', status: 'PENDING' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-p/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('CANCELLED');
    });

    it('cancels a RUNNING job', async () => {
      jobs.set('job-r', makeJob({ id: 'job-r', status: 'RUNNING' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-r/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('CANCELLED');
    });

    it('returns 409 for already COMPLETED job', async () => {
      jobs.set('job-c', makeJob({ id: 'job-c', status: 'COMPLETED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-c/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(409);
    });

    it('returns 409 for already CANCELLED job', async () => {
      jobs.set('job-x', makeJob({ id: 'job-x', status: 'CANCELLED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-x/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(409);
    });

    it('returns 409 for FAILED job', async () => {
      jobs.set('job-f', makeJob({ id: 'job-f', status: 'FAILED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-f/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2', status: 'RUNNING' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Retry ────────────────────────────────────────────────────────────────

  describe('POST /jobs/:id/retry', () => {
    it('retries a FAILED job and returns 202', async () => {
      jobs.set('job-f', makeJob({ id: 'job-f', status: 'FAILED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-f/retry', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe('PENDING');
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('retries a COMPLETED job', async () => {
      jobs.set('job-c', makeJob({ id: 'job-c', status: 'COMPLETED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-c/retry', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(202);
    });

    it('returns 409 for a RUNNING job', async () => {
      jobs.set('job-r', makeJob({ id: 'job-r', status: 'RUNNING' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-r/retry', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2', status: 'FAILED' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/retry', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('uses a distinct BullMQ job ID for retry', async () => {
      jobs.set('job-f2', makeJob({ id: 'job-f2', status: 'FAILED' }));
      const app = await buildTestApp();
      await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-f2/retry', ...as('tok-admin-ws1') });
      expect(enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ jobId: 'job-f2' }),
        expect.objectContaining({ jobId: expect.stringContaining('retry') }),
      );
    });
  });

  // ── Activity ─────────────────────────────────────────────────────────────

  describe('GET /jobs/:id/activity', () => {
    it('returns activities for a job', async () => {
      jobs.set('job-1', makeJob());
      activities.push({ id: 'act-1', workspaceId: 'ws1', jobId: 'job-1', type: 'CREATED', summary: 'Job created', createdAt: new Date() });
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-1/activity', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    it('returns 404 for another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-ws2/activity', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Save / Promote ───────────────────────────────────────────────────────

  describe('POST /jobs/:id/save', () => {
    it('promotes discovered leads and returns result', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs/job-1/save',
        payload: { discoveredLeadIds: ['dl-1', 'dl-2'] },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('promoted');
      expect(body).toHaveProperty('leadIds');
      expect(promoteLeads).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws1', discoveredLeadIds: ['dl-1', 'dl-2'] }),
      );
    });

    it('rejects empty discoveredLeadIds array', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/lead-discovery/jobs/job-1/save',
        payload: { discoveredLeadIds: [] },
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Requalify ────────────────────────────────────────────────────────────

  describe('POST /jobs/:id/requalify', () => {
    it('requalifies when called by ADMIN', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-1/requalify', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('requalified');
      expect(body).toHaveProperty('newlyQualified');
      expect(requalify).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws1', jobId: 'job-1' }));
    });

    it('rejects non-admin (MEMBER) with 403', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-1/requalify', ...as('tok-member-ws1') });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/requalify', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Security ─────────────────────────────────────────────────────────────

  describe('workspace isolation (security)', () => {
    beforeEach(() => {
      jobs.set('job-ws1', makeJob({ id: 'job-ws1', workspaceId: 'ws1' }));
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2', status: 'RUNNING' }));
    });

    it('ws1 user cannot GET ws2 job', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-ws2', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('ws1 user cannot GET ws2 job results', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-ws2/results', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('ws1 user cannot cancel ws2 job', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/cancel', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('ws1 user cannot retry ws2 job', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/retry', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('ws1 user cannot requalify ws2 job', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'POST', url: '/lead-discovery/jobs/job-ws2/requalify', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });

    it('ws1 user cannot view ws2 job activity', async () => {
      const app = await buildTestApp();
      const res = await app.inject({ method: 'GET', url: '/lead-discovery/jobs/job-ws2/activity', ...as('tok-admin-ws1') });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Input validation (malicious input) ───────────────────────────────────

  describe('input validation', () => {
    it('rejects invalid sort value', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?sortBy=DROP_TABLE',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects negative page number', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs?page=-1',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects limit exceeding maximum', async () => {
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs?limit=100000',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('handles very long search string gracefully', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const longSearch = 'a'.repeat(300);
      const res = await app.inject({
        method: 'GET',
        url: `/lead-discovery/jobs/job-1/results?search=${longSearch}`,
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid emailStatus filter', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/results?emailStatus=DROP_TABLE',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Export ───────────────────────────────────────────────────────────────

  describe('GET /jobs/:id/export', () => {
    it('exports as CSV', async () => {
      jobs.set('job-1', makeJob());
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-1/export?format=csv',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });

    it('returns 404 for another workspace job', async () => {
      jobs.set('job-ws2', makeJob({ id: 'job-ws2', workspaceId: 'ws2' }));
      const app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/lead-discovery/jobs/job-ws2/export',
        ...as('tok-admin-ws1'),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
