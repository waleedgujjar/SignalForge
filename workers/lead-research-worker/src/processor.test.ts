import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindFirst = vi.fn();
vi.mock('@signalforge/database', () => ({
  prisma: { leadResearch: { findFirst: mockFindFirst } },
}));

const envState: Record<string, unknown> = {
  LINKEDIN_RESEARCH_ENABLED: true,
  LINKEDIN_RESEARCH_TIMEOUT_MS: 1_000,
  LINKEDIN_RESEARCH_PROVIDER: 'public',
  LINKEDIN_RESEARCH_PUBLIC_FETCH_ENABLED: true,
  WEB_RESEARCH_ENABLED: false,
  WEB_RESEARCH_TIMEOUT_MS: 30_000,
  WEB_RESEARCH_MAX_PAGES: 5,
  WEB_RESEARCH_AI_INTERPRETATION_ENABLED: false,
};
vi.mock('@signalforge/config', () => ({ loadEnv: () => envState }));

const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: (...args: unknown[]) => mockPublish(...args),
}));

const service = {
  markInProgress: vi.fn().mockResolvedValue(undefined),
  persistOutcome: vi.fn().mockResolvedValue(undefined),
  persistFailure: vi.fn().mockResolvedValue(undefined),
  incrementProviderCounters: vi.fn().mockResolvedValue(undefined),
  getProviderConfigs: vi.fn().mockResolvedValue([]),
  resolveWorkspaceEnabled: vi.fn(() => () => true),
  computeInputHash: vi.fn(() => 'hash-1'),
};
const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockEnsureEnrichment = vi.fn().mockResolvedValue(undefined);
const mockRun = vi.fn();
const mockWebRun = vi.fn();

function mapOutcome(
  run: { outcome: Record<string, unknown> },
  completedAt: Date,
) {
  const o = run.outcome as Record<string, unknown>;
  if (o.status === 'COMPLETED' || o.status === 'PARTIAL') {
    return {
      status: o.status,
      provider: o.provider,
      confidence: o.confidence,
      summary: o.summary ?? null,
      structuredData: o.data,
      provenance: o.provenance,
      rawData: null,
      errorCode: null,
      errorMessage: null,
      completedAt,
    };
  }
  return {
    status: o.status,
    provider: o.provider,
    confidence: null,
    summary: null,
    structuredData: null,
    provenance: null,
    rawData: null,
    errorCode: o.errorCode,
    errorMessage: o.errorMessage,
    completedAt,
  };
}

vi.mock('@signalforge/lead-research', () => ({
  LinkedInResearchService: class {
    run = mockRun;
  },
  WebResearchService: class {
    run = mockWebRun;
  },
  leadResearchService: service,
  selectProviderChain: vi.fn(() => [{ name: 'public' }, { name: 'manual' }]),
  selectWebProviderChain: vi.fn(() => [{ name: 'website' }, { name: 'manual' }]),
  mapOutcomeToRecordUpdate: mapOutcome,
  mapWebOutcomeToRecordUpdate: mapOutcome,
  logResearchActivity: (...args: unknown[]) => mockLogActivity(...args),
  ensureEnrichmentQueued: (...args: unknown[]) => mockEnsureEnrichment(...args),
  RETRYABLE_ERROR_CODES: new Set(['TIMEOUT', 'PROVIDER_UNAVAILABLE']),
}));

const LOG_ALLOWLIST = new Set([
  'worker',
  'message',
  'timestamp',
  'jobId',
  'researchId',
  'leadId',
  'workspaceId',
  'source',
  'provider',
  'operation',
  'status',
  'startedAt',
  'completedAt',
  'durationMs',
  'errorCode',
  'errorMessage',
  'retryCount',
  'attempt',
  'queues',
  'concurrency',
]);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    workspaceId: 'ws1',
    leadId: 'l1',
    source: 'LINKEDIN',
    researchType: 'COMPANY',
    status: 'QUEUED',
    normalizedUrl: 'https://www.linkedin.com/company/acme',
    sourceUrl: 'https://www.linkedin.com/company/acme?trk=x',
    lead: { id: 'l1', workspaceId: 'ws1', company: 'Acme', fullName: null, jobTitle: null },
    ...overrides,
  };
}

const job = { workspaceId: 'ws1', leadId: 'l1', researchId: 'r1' };
const meta = { attemptsMade: 0, maxAttempts: 2 };

describe('processLeadResearchJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.LINKEDIN_RESEARCH_ENABLED = true;
    envState.WEB_RESEARCH_ENABLED = false;
    service.getProviderConfigs.mockResolvedValue([]);
    service.resolveWorkspaceEnabled.mockImplementation(() => () => true);
  });

  it('skips a row that does not exist in the workspace without calling any provider', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result).toEqual({ researchId: 'r1', status: 'SKIPPED', reason: 'NOT_FOUND' });
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', workspaceId: 'ws1' } }),
    );
  });

  it('fails a row whose lead belongs to another workspace', async () => {
    mockFindFirst.mockResolvedValue(row({ lead: { id: 'l1', workspaceId: 'ws-other', company: null, fullName: null, jobTitle: null } }));
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result.status).toBe('FAILED');
    expect(service.persistFailure).toHaveBeenCalledWith('r1', 'WORKSPACE_MISMATCH', expect.any(String), null);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('records FEATURE_DISABLED and runs nothing when the flag is off', async () => {
    envState.LINKEDIN_RESEARCH_ENABLED = false;
    mockFindFirst.mockResolvedValue(row());
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result).toEqual({ researchId: 'r1', status: 'UNAVAILABLE', reason: 'FEATURE_DISABLED' });
    expect(service.persistOutcome).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'UNAVAILABLE', errorCode: 'FEATURE_DISABLED' }),
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockEnsureEnrichment).not.toHaveBeenCalled();
  });

  it('persists a COMPLETED outcome, publishes the event and re-queues enrichment', async () => {
    mockFindFirst.mockResolvedValue(row());
    mockRun.mockResolvedValue({
      outcome: {
        status: 'COMPLETED',
        provider: 'public',
        data: { company: { name: 'Acme' } },
        provenance: [],
        confidence: 'MEDIUM',
        summary: 'Acme on LinkedIn',
      },
      attempts: [{ provider: 'public', status: 'COMPLETED', durationMs: 5 }],
      providerUsed: 'public',
    });
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result.status).toBe('COMPLETED');
    expect(service.markInProgress).toHaveBeenCalledWith('r1');
    expect(service.persistOutcome).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'COMPLETED', provider: 'public', inputHash: 'hash-1' }),
    );
    expect(service.incrementProviderCounters).toHaveBeenCalledWith('ws1', 'LINKEDIN', 'public', 'success');
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'RESEARCH_COMPLETED', status: 'COMPLETED', researchId: 'r1' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'LEAD_RESEARCH_COMPLETED',
        idempotencyKey: 'lead-research:r1',
        workspaceId: 'ws1',
        leadId: 'l1',
      }),
    );
    expect(mockEnsureEnrichment).toHaveBeenCalledWith('ws1', 'l1');
  });

  it('persists MANUAL_REVIEW for a refusal without throwing or re-queuing enrichment', async () => {
    mockFindFirst.mockResolvedValue(row());
    mockRun.mockResolvedValue({
      outcome: {
        status: 'MANUAL_REVIEW',
        provider: 'public',
        errorCode: 'LOGIN_REQUIRED',
        errorMessage: 'LinkedIn served a sign-in wall',
        retryable: false,
      },
      attempts: [],
      providerUsed: 'public',
    });
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result).toEqual({ researchId: 'r1', status: 'MANUAL_REVIEW', reason: 'LOGIN_REQUIRED' });
    expect(service.persistOutcome).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'MANUAL_REVIEW', errorCode: 'LOGIN_REQUIRED' }),
    );
    expect(service.incrementProviderCounters).toHaveBeenCalledWith('ws1', 'LINKEDIN', 'public', 'manual_review');
    expect(mockEnsureEnrichment).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('rethrows a retryable TIMEOUT only while attempts remain', async () => {
    mockFindFirst.mockResolvedValue(row());
    mockRun.mockResolvedValue({
      outcome: {
        status: 'FAILED',
        provider: 'public',
        errorCode: 'TIMEOUT',
        errorMessage: 'Fetch exceeded 1000ms',
        retryable: true,
      },
      attempts: [],
      providerUsed: 'public',
    });
    const { processLeadResearchJob, RetryableResearchError } = await import('./processor.js');

    await expect(processLeadResearchJob(job, { attemptsMade: 0, maxAttempts: 2 })).rejects.toBeInstanceOf(
      RetryableResearchError,
    );
    expect(service.persistFailure).toHaveBeenCalledWith('r1', 'TIMEOUT', 'Fetch exceeded 1000ms', 'public');

    const last = await processLeadResearchJob(job, { attemptsMade: 1, maxAttempts: 2 });
    expect(last).toEqual({ researchId: 'r1', status: 'FAILED', reason: 'TIMEOUT' });
  });

  it('turns an unexpected provider exception into FAILED without rethrowing', async () => {
    mockFindFirst.mockResolvedValue(row());
    mockRun.mockRejectedValue(new Error('boom token=abc123 https://x.test/a?li_at=secret'));
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result).toEqual({ researchId: 'r1', status: 'FAILED', reason: 'UNKNOWN' });
    const [, code, message] = service.persistFailure.mock.calls[0] as [string, string, string, unknown];
    expect(code).toBe('UNKNOWN');
    expect(message).not.toContain('abc123');
    expect(message).not.toContain('li_at=secret');
  });

  it('only logs allow-listed fields', async () => {
    mockFindFirst.mockResolvedValue(row());
    mockRun.mockResolvedValue({
      outcome: { status: 'COMPLETED', provider: 'public', data: {}, provenance: [], confidence: 'LOW', summary: null },
      attempts: [],
      providerUsed: 'public',
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { processLeadResearchJob } = await import('./processor.js');

    await processLeadResearchJob(job, meta);

    expect(info).toHaveBeenCalled();
    for (const call of info.mock.calls) {
      const parsed = JSON.parse(String(call[0])) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        expect(LOG_ALLOWLIST.has(key), `unexpected log field ${key}`).toBe(true);
      }
      expect(JSON.stringify(parsed)).not.toContain('trk=');
    }
    info.mockRestore();
  });

  // ─── Web research routing ───────────────────────────────────────────────

  it('routes source WEB to WebResearchService (test #9)', async () => {
    envState.WEB_RESEARCH_ENABLED = true;
    mockFindFirst.mockResolvedValue(row({
      source: 'WEB',
      researchType: 'COMPANY',
      normalizedUrl: 'https://acme.com',
      sourceUrl: 'https://acme.com',
    }));
    mockWebRun.mockResolvedValue({
      outcome: {
        status: 'COMPLETED',
        provider: 'website',
        data: { company: { name: 'Acme' } },
        provenance: [],
        confidence: 'MEDIUM',
        summary: 'Acme',
      },
      attempts: [{ provider: 'website', status: 'COMPLETED', durationMs: 100 }],
      providerUsed: 'website',
    });
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result.status).toBe('COMPLETED');
    expect(mockWebRun).toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(service.persistOutcome).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'COMPLETED', provider: 'website' }),
    );
    expect(service.incrementProviderCounters).toHaveBeenCalledWith('ws1', 'WEB', 'website', 'success');
  });

  it('routes source LINKEDIN unchanged when processing WEB jobs too (test #10)', async () => {
    envState.LINKEDIN_RESEARCH_ENABLED = true;
    envState.WEB_RESEARCH_ENABLED = true;
    mockFindFirst.mockResolvedValue(row({ source: 'LINKEDIN' }));
    mockRun.mockResolvedValue({
      outcome: {
        status: 'COMPLETED',
        provider: 'public',
        data: { company: { name: 'Acme' } },
        provenance: [],
        confidence: 'MEDIUM',
        summary: 'Acme on LinkedIn',
      },
      attempts: [{ provider: 'public', status: 'COMPLETED', durationMs: 5 }],
      providerUsed: 'public',
    });
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result.status).toBe('COMPLETED');
    expect(mockRun).toHaveBeenCalled();
    expect(mockWebRun).not.toHaveBeenCalled();
  });

  it('returns FEATURE_DISABLED for WEB when WEB_RESEARCH_ENABLED=false (test #11)', async () => {
    envState.WEB_RESEARCH_ENABLED = false;
    mockFindFirst.mockResolvedValue(row({ source: 'WEB', researchType: 'COMPANY' }));
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result).toEqual({ researchId: 'r1', status: 'UNAVAILABLE', reason: 'FEATURE_DISABLED' });
    expect(service.persistOutcome).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'UNAVAILABLE', errorCode: 'FEATURE_DISABLED' }),
    );
    expect(mockWebRun).not.toHaveBeenCalled();
  });

  it('returns UNSUPPORTED_URL for unknown source', async () => {
    mockFindFirst.mockResolvedValue(row({ source: 'FACEBOOK' }));
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(job, meta);

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.reason).toBe('UNSUPPORTED_URL');
  });

  it('allows force refresh even when COMPLETED for WEB (test #14)', async () => {
    envState.WEB_RESEARCH_ENABLED = true;
    mockFindFirst.mockResolvedValue(row({
      source: 'WEB',
      researchType: 'COMPANY',
      status: 'COMPLETED',
      normalizedUrl: 'https://acme.com',
    }));
    mockWebRun.mockResolvedValue({
      outcome: {
        status: 'COMPLETED',
        provider: 'website',
        data: { company: { name: 'Acme' } },
        provenance: [],
        confidence: 'MEDIUM',
        summary: 'Acme',
      },
      attempts: [],
      providerUsed: 'website',
    });
    const { processLeadResearchJob } = await import('./processor.js');

    const result = await processLeadResearchJob(
      { ...job, forceRefresh: true },
      meta,
    );

    expect(result.status).toBe('COMPLETED');
    expect(mockWebRun).toHaveBeenCalled();
  });
});
