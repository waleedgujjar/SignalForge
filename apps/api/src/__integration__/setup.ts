/**
 * Global setup for integration tests.
 *
 * This file is loaded via `setupFiles` in vitest.integration.config.ts.
 * It mocks every external dependency that buildApp() transitively imports,
 * pointing database and queue to the shared mock infrastructure while
 * providing noop stubs for everything else.
 */
import { vi, beforeEach } from 'vitest';
import { getPrisma, resetAll } from './helpers/mock-db.js';
import { buildQueueMock, clearEnqueuedJobs } from './helpers/queue-spy.js';

// ─── Environment ────────────────────────────────────────────────────────────

process.env.NODE_ENV = 'test';

// ─── @signalforge/config ────────────────────────────────────────────────────

vi.mock('@signalforge/config', () => {
  const env = () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    SESSION_SECRET: 'integration-test-session-secret-32ch',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    REDIS_URL: 'redis://localhost:6380',
    ENCRYPTION_KEY: 'test-encryption-key-32-characters!',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'http://localhost:11434',
    OPENAI_MODEL: 'test-model',
    GOOGLE_DRIVE_CLIENT_ID: 'test-gd-id',
    GOOGLE_DRIVE_CLIENT_SECRET: 'test-gd-secret',
    GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:3000/callback',
    SMTP_HOST: 'smtp.test.local',
    SMTP_PORT: '587',
    SMTP_USER: 'test',
    SMTP_PASS: 'test',
    FROM_EMAIL: 'noreply@test.signalforge',
  });
  return { loadEnv: env, getEnv: env };
});

// ─── @signalforge/database ──────────────────────────────────────────────────

vi.mock('@signalforge/database', () => ({
  prisma: getPrisma(),
  checkDatabaseConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, opts: { code: string }) {
        super(message);
        this.code = opts.code;
      }
    },
  },
}));

// ─── @signalforge/queue ─────────────────────────────────────────────────────

vi.mock('@signalforge/queue', () => buildQueueMock());

// ─── @signalforge/ai ────────────────────────────────────────────────────────

vi.mock('@signalforge/ai', () => ({
  checkAIHealth: vi.fn(() => ({ ok: true, provider: 'test' })),
  createAIProvider: vi.fn(() => ({
    chat: vi.fn(async () => ({ content: 'AI response' })),
    generateObject: vi.fn(async () => ({ object: {} })),
  })),
}));

// ─── @signalforge/automations ───────────────────────────────────────────────

vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: vi.fn(async () => 'wf-evt-mock'),
  workflowService: {
    list: vi.fn(async () => ({ workflows: [], total: 0 })),
    create: vi.fn(async () => ({ id: 'wf-mock' })),
    getById: vi.fn(async () => null),
    updateDraft: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    archive: vi.fn(async () => ({})),
    duplicate: vi.fn(async () => ({ id: 'wf-dup-mock' })),
    fromTemplate: vi.fn(async () => ({ id: 'wf-tpl-mock' })),
    listExecutions: vi.fn(async () => ({ executions: [], total: 0 })),
    getExecution: vi.fn(async () => null),
    cancelExecution: vi.fn(async () => ({})),
    listLogs: vi.fn(async () => []),
    listActivities: vi.fn(async () => ({ activities: [], total: 0 })),
  },
  workflowStatsService: {
    listWorkspaceStats: vi.fn(async () => ({ workflows: [] })),
  },
  notificationService: {
    list: vi.fn(async () => ({ notifications: [], total: 0 })),
    markRead: vi.fn(async () => ({})),
    unreadCount: vi.fn(async () => 0),
    create: vi.fn(async () => ({ id: 'notif-mock' })),
  },
  validateWorkflowGraph: vi.fn(() => ({ valid: true, errors: [] })),
  getTemplates: vi.fn(() => []),
}));

// ─── @signalforge/verification ──────────────────────────────────────────────

vi.mock('@signalforge/verification', () => ({
  verificationJobService: {
    enqueueVerification: vi.fn(async () => ({ jobId: 'vj-mock' })),
  },
}));

// ─── @signalforge/lead-research ─────────────────────────────────────────────

vi.mock('@signalforge/lead-research', () => ({
  isLinkedInResearchEnabled: vi.fn(() => false),
  isWebResearchEnabled: vi.fn(() => false),
  leadResearchService: {
    getSuggestions: vi.fn(async () => []),
    createResearchJob: vi.fn(async () => ({ id: 'rj-mock' })),
  },
}));

// ─── @signalforge/lead-discovery ────────────────────────────────────────────

vi.mock('@signalforge/lead-discovery', () => ({
  discoveryService: {},
  leadDiscoveryService: {},
  isPlaceholderEmail: vi.fn(() => false),
  promoteDiscoveredLeads: vi.fn(async () => ({ promoted: 0, skipped: 0 })),
  logDiscoveryActivity: vi.fn(async () => ({})),
  requalifyLeads: vi.fn(async () => ({ requalified: 0 })),
  loadDedupCandidates: vi.fn(async () => []),
  normalizeLeadData: vi.fn((data: Record<string, unknown>) => data),
  listSources: vi.fn(() => []),
  isFileBased: vi.fn(() => false),
  toCsv: vi.fn(() => ''),
  toXlsx: vi.fn(async () => Buffer.alloc(0)),
  DISCOVERED_LEAD_EXPORT_COLUMNS: [],
  AdapterNotConfiguredError: class extends Error { constructor(m: string) { super(m); this.name = 'AdapterNotConfiguredError'; } },
  AdapterNotAvailableError: class extends Error { constructor(m: string) { super(m); this.name = 'AdapterNotAvailableError'; } },
  InvalidDiscoveryRequestError: class extends Error { constructor(m: string) { super(m); this.name = 'InvalidDiscoveryRequestError'; } },
  normalizeLead: vi.fn((data: Record<string, unknown>) => data),
  normalizeStateName: vi.fn((s: string) => s),
  normalizeCountryCode: vi.fn((s: string) => s),
  hasImportableRowData: vi.fn(() => true),
  generatePlaceholderEmail: vi.fn(() => 'placeholder@signalforge.local'),
  resolveLeadName: vi.fn(() => ({ firstName: null, lastName: null, fullName: null })),
  getLeadDisplayName: vi.fn(() => 'Unknown'),
  createDedupIndex: vi.fn(() => ({ byEmail: new Map(), byPhone: new Map(), byDomainCompany: new Map() })),
  findDuplicate: vi.fn(() => null),
  toDedupEntry: vi.fn(() => ({})),
  addToIndex: vi.fn(),
  mapRow: vi.fn((row: Record<string, unknown>) => row),
}));

// ─── @signalforge/integrations ──────────────────────────────────────────────

vi.mock('@signalforge/integrations', () => ({
  GoogleDriveAdapter: vi.fn(),
  detectLeadImportMappings: vi.fn(() => []),
  buildLeadImportMappingsRecord: vi.fn(() => ({})),
  parseFileStream: vi.fn(async () => []),
  detectColumnMappings: vi.fn(() => []),
}));

// ─── @signalforge/campaigns ─────────────────────────────────────────────────

vi.mock('@signalforge/campaigns', () => ({
  campaignService: {
    createDraft: vi.fn(async () => ({ id: 'camp-mock' })),
    updateCampaign: vi.fn(async () => ({})),
    launch: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({})),
    archive: vi.fn(async () => ({})),
    getActivity: vi.fn(async () => ({ activities: [], total: 0 })),
  },
  campaignLeadService: {
    enrollLeads: vi.fn(async () => ({ enrolled: 0, skipped: 0 })),
    removeLead: vi.fn(async () => ({})),
    previewEligibility: vi.fn(async () => ({ eligible: [], ineligible: [] })),
  },
  campaignValidationService: {
    validate: vi.fn(async () => ({ valid: true, errors: [] })),
  },
  campaignPreviewService: {
    preview: vi.fn(async () => ({ subject: '', body: '' })),
    previewVariations: vi.fn(async () => []),
  },
  campaignExecutionPlanner: {
    buildPlan: vi.fn(async () => ({ plan: [] })),
  },
  sequenceService: {
    addStep: vi.fn(async () => ({ id: 'step-mock' })),
    updateStep: vi.fn(async () => ({})),
    deleteStep: vi.fn(async () => ({})),
    reorderSteps: vi.fn(async () => ({})),
    duplicateStep: vi.fn(async () => ({ id: 'step-dup-mock' })),
    seedFollowUpSteps: vi.fn(async () => ({})),
  },
  leadSequenceService: {
    getLeadSequenceStatus: vi.fn(async () => null),
  },
  campaignEligibilityService: {
    checkLeadsBulk: vi.fn(async () => ({ eligible: [], ineligible: [] })),
  },
  syncDelayDays: vi.fn(async () => ({})),
}));

// ─── @signalforge/lead-enrichment ───────────────────────────────────────────

vi.mock('@signalforge/lead-enrichment', () => ({
  leadEnrichmentService: {
    enqueue: vi.fn(async () => ({})),
    getStatus: vi.fn(async () => null),
  },
}));

// ─── @signalforge/allocation ────────────────────────────────────────────────

vi.mock('@signalforge/allocation', () => ({
  smtpPoolService: {
    listPools: vi.fn(async () => []),
    getPool: vi.fn(async () => null),
    createPool: vi.fn(async () => ({ id: 'pool-mock' })),
    updatePool: vi.fn(async () => ({})),
    deletePool: vi.fn(async () => ({})),
    addMember: vi.fn(async () => ({})),
    removeMember: vi.fn(async () => ({})),
  },
}));

// ─── @signalforge/website-scanner ───────────────────────────────────────────

vi.mock('@signalforge/website-scanner', () => ({
  websiteIntelligenceService: {
    analyze: vi.fn(async () => ({ id: 'wa-mock' })),
  },
}));

// ─── @signalforge/sending ───────────────────────────────────────────────────

vi.mock('@signalforge/sending', () => ({
  sendingJobService: {
    listJobs: vi.fn(async () => ({ jobs: [], total: 0 })),
    getJob: vi.fn(async () => null),
    getQueueStats: vi.fn(async () => ({})),
    retryJob: vi.fn(async () => ({})),
    cancelJob: vi.fn(async () => ({})),
    bootstrapCampaign: vi.fn(async () => ({})),
    pauseCampaignJobs: vi.fn(async () => ({})),
    resumeCampaignJobs: vi.fn(async () => ({})),
    cancelCampaignJobs: vi.fn(async () => ({})),
    cancelPendingFollowUpJobs: vi.fn(async () => ({})),
    getCampaignSendingStats: vi.fn(async () => ({})),
  },
}));

// ─── @signalforge/email ─────────────────────────────────────────────────────

vi.mock('@signalforge/email', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'msg-mock' })),
  encryptSecret: vi.fn((val: string) => `encrypted:${val}`),
  decryptSecret: vi.fn((val: string) => val.replace('encrypted:', '')),
  validateTemplate: vi.fn(() => ({ valid: true, errors: [] })),
  leadToVariableContext: vi.fn(() => ({})),
}));

// ─── @signalforge/inbound ───────────────────────────────────────────────────

vi.mock('@signalforge/inbound', () => ({
  InboundConnectionTestService: vi.fn(() => ({
    test: vi.fn(async () => ({ ok: true })),
  })),
  testImapConnection: vi.fn(async () => ({ ok: true })),
}));

// ─── @signalforge/inbox ─────────────────────────────────────────────────────

vi.mock('@signalforge/inbox', () => ({
  createInboxSyncService: vi.fn(() => ({
    syncMailbox: vi.fn(async () => ({})),
  })),
  conversationService: {
    list: vi.fn(async () => ({ conversations: [], total: 0 })),
    getById: vi.fn(async () => null),
    updateStatus: vi.fn(async () => ({})),
  },
  messageService: {
    list: vi.fn(async () => ({ messages: [], total: 0 })),
    getById: vi.fn(async () => null),
  },
  noteService: {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'note-mock' })),
    delete: vi.fn(async () => ({})),
  },
  statsService: {
    getStats: vi.fn(async () => ({})),
  },
  createSendReplyService: vi.fn(() => ({
    send: vi.fn(async () => ({ messageId: 'reply-mock' })),
  })),
  createReplyComposer: vi.fn(() => ({
    compose: vi.fn(async () => ({ subject: '', body: '' })),
  })),
}));

// ─── @signalforge/mailboxes ─────────────────────────────────────────────────

vi.mock('@signalforge/mailboxes', () => ({
  MailboxService: vi.fn(() => ({
    create: vi.fn(async () => ({ id: 'mb-mock' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  })),
  MailboxConnectionService: vi.fn(() => ({
    test: vi.fn(async () => ({ ok: true })),
  })),
  mailboxEligibilityService: {
    isMailboxEligible: vi.fn(async () => true),
  },
  mailboxUsageService: {
    getUsageSummary: vi.fn(async () => ({})),
  },
}));

// ─── Reset between tests ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetAll();
  clearEnqueuedJobs();
});
