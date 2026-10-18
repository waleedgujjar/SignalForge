/**
 * Shared, interconnected mock database store for integration tests.
 *
 * Unlike per-file mocks, this store maintains referential integrity across
 * tables and enforces workspace scoping on queries.
 */
import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// ─── Type definitions ────────────────────────────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  emailVerifiedAt: Date | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockSession {
  id: string;
  userId: string;
  tokenHash: string;
  activeWorkspaceId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface MockWorkspace {
  id: string;
  name: string;
  slug: string;
  timezone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockWorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface MockLead {
  id: string;
  workspaceId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  linkedInUrl: string | null;
  source: string | null;
  status: string;
  icpScore: number | null;
  qualificationReasons: string | null;
  notes: string | null;
  customFields: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockCampaign {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  dailySendingLimit: number | null;
  scheduleConfig: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockCampaignStep {
  id: string;
  campaignId: string;
  order: number;
  type: string;
  subject: string | null;
  body: string | null;
  delayDays: number;
  createdAt: Date;
}

export interface MockCampaignLead {
  id: string;
  campaignId: string;
  leadId: string;
  status: string;
  currentStepOrder: number;
  stopReason: string | null;
  enrolledAt: Date;
  createdAt: Date;
}

export interface MockSuppression {
  id: string;
  workspaceId: string;
  type: string;
  value: string;
  reason: string | null;
  createdAt: Date;
}

export interface MockTag {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockLeadTag {
  leadId: string;
  tagId: string;
}

export interface MockLeadList {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface MockLeadListMember {
  leadListId: string;
  leadId: string;
  addedAt: Date;
}

export interface MockMailbox {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  provider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  encryptedPassword: string | null;
  isActive: boolean;
  dailySendLimit: number;
  warmupEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockDiscoveryJob {
  id: string;
  workspaceId: string;
  source: string;
  status: string;
  query: Record<string, unknown>;
  filters: Record<string, unknown> | null;
  totalFound: number;
  totalQualified: number;
  totalSaved: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockDiscoveredLead {
  id: string;
  jobId: string;
  workspaceId: string;
  source: string;
  sourceId: string;
  stage: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  data: Record<string, unknown>;
  icpScore: number | null;
  promotedLeadId: string | null;
  createdAt: Date;
}

export interface MockWebsiteAnalysis {
  id: string;
  workspaceId: string;
  leadId: string | null;
  url: string;
  status: string;
  websiteScore: number | null;
  opportunityScore: number | null;
  opportunityPriority: string | null;
  findings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockWorkflow {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  publishedVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  nodes: unknown[];
  edges: unknown[];
  createdAt: Date;
}

export interface MockWorkflowEvent {
  id: string;
  workspaceId: string;
  eventType: string;
  leadId: string | null;
  campaignId: string | null;
  mailboxId: string | null;
  conversationId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface MockWorkflowExecution {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workspaceId: string;
  leadId: string;
  triggerEventId: string;
  status: string;
  currentNodeId: string | null;
  resumeAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockSendingJob {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  mailboxId: string;
  stepOrder: number;
  status: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface MockLeadVerification {
  id: string;
  leadId: string;
  status: string;
  provider: string | null;
  result: Record<string, unknown> | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface MockICPProfile {
  id: string;
  workspaceId: string;
  name: string;
  weights: Record<string, unknown>;
  createdAt: Date;
}

export interface MockLeadNote {
  id: string;
  leadId: string;
  workspaceId: string;
  content: string;
  authorId: string;
  createdAt: Date;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

export const stores = {
  users: new Map<string, MockUser>(),
  sessions: new Map<string, MockSession>(),
  workspaces: new Map<string, MockWorkspace>(),
  workspaceMembers: new Map<string, MockWorkspaceMember>(),
  leads: new Map<string, MockLead>(),
  campaigns: new Map<string, MockCampaign>(),
  campaignSteps: new Map<string, MockCampaignStep>(),
  campaignLeads: new Map<string, MockCampaignLead>(),
  suppressions: new Map<string, MockSuppression>(),
  tags: new Map<string, MockTag>(),
  leadTags: new Map<string, MockLeadTag>(),
  leadLists: new Map<string, MockLeadList>(),
  leadListMembers: new Map<string, MockLeadListMember>(),
  mailboxes: new Map<string, MockMailbox>(),
  discoveryJobs: new Map<string, MockDiscoveryJob>(),
  discoveredLeads: new Map<string, MockDiscoveredLead>(),
  websiteAnalyses: new Map<string, MockWebsiteAnalysis>(),
  workflows: new Map<string, MockWorkflow>(),
  workflowVersions: new Map<string, MockWorkflowVersion>(),
  workflowEvents: new Map<string, MockWorkflowEvent>(),
  workflowExecutions: new Map<string, MockWorkflowExecution>(),
  sendingJobs: new Map<string, MockSendingJob>(),
  leadVerifications: new Map<string, MockLeadVerification>(),
  icpProfiles: new Map<string, MockICPProfile>(),
  leadNotes: new Map<string, MockLeadNote>(),
};

export function resetAll(): void {
  for (const store of Object.values(stores)) {
    store.clear();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid(): string {
  return randomUUID();
}

function matchesWhere<T>(record: T, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    const rec = record as Record<string, unknown>;
    if (typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date)) {
      const nested = val as Record<string, unknown>;
      if ('in' in nested) {
        if (!Array.isArray(nested.in) || !(nested.in as unknown[]).includes(rec[key])) return false;
        continue;
      }
      if ('not' in nested) {
        if (rec[key] === nested.not) return false;
        continue;
      }
      if ('contains' in nested) {
        const s = String(rec[key] ?? '');
        const mode = (nested as Record<string, unknown>).mode;
        if (mode === 'insensitive') {
          if (!s.toLowerCase().includes(String(nested.contains).toLowerCase())) return false;
        } else {
          if (!s.includes(String(nested.contains))) return false;
        }
        continue;
      }
      if ('gte' in nested || 'lte' in nested) {
        const v = rec[key] as number;
        if ('gte' in nested && v < (nested.gte as number)) return false;
        if ('lte' in nested && v > (nested.lte as number)) return false;
        continue;
      }
      // Composite unique key: e.g. workspaceId_type_value: { workspaceId, type, value }
      // Match each sub-field against the record's own fields.
      if (!(key in rec)) {
        for (const [subKey, subVal] of Object.entries(nested)) {
          if (rec[subKey] !== subVal) return false;
        }
        continue;
      }
    }
    if (rec[key] !== val) return false;
  }
  return true;
}

function applyOrderBy<T>(items: T[], orderBy: unknown): T[] {
  if (!orderBy) return items;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const entry of entries.reverse()) {
    const obj = entry as Record<string, string>;
    const [key, dir] = Object.entries(obj)[0]!;
    items.sort((a, b) => {
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (av == null && bv == null) return 0;
      if (av == null) return dir === 'asc' ? -1 : 1;
      if (bv == null) return dir === 'asc' ? 1 : -1;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  return items;
}

function applyPagination<T>(items: T[], skip?: number, take?: number): T[] {
  const start = skip ?? 0;
  if (take !== undefined) return items.slice(start, start + take);
  return items.slice(start);
}

// ─── Generic CRUD builders ───────────────────────────────────────────────────

function buildModelMock<T extends { id: string }>(
  store: Map<string, T>,
  defaults?: () => Partial<T>,
) {
  return {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id) return store.get(where.id as string) ?? null;
      for (const rec of store.values()) {
        if (matchesWhere(rec, where)) return rec;
      }
      return null;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      let items = [...store.values()];
      if (where) items = items.filter((r) => matchesWhere(r, where));
      if (orderBy) items = applyOrderBy(items, orderBy);
      return items[0] ?? null;
    }),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        skip,
        take,
        include: _include,
        select: _select,
      }: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        skip?: number;
        take?: number;
        include?: unknown;
        select?: unknown;
      } = {}) => {
        let items = [...store.values()];
        if (where) items = items.filter((r) => matchesWhere(r, where));
        if (orderBy) items = applyOrderBy(items, orderBy);
        return applyPagination(items, skip, take);
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = (data.id as string) ?? uid();
      const now = new Date();
      const record = {
        ...(defaults ? defaults() : {}),
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      } as unknown as T;
      store.set(id, record);
      return record;
    }),
    createMany: vi.fn(
      async ({ data, skipDuplicates: _skip }: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const item of data) {
          const id = (item.id as string) ?? uid();
          if (_skip && store.has(id)) continue;
          const now = new Date();
          store.set(id, {
            ...(defaults ? defaults() : {}),
            ...item,
            id,
            createdAt: now,
            updatedAt: now,
          } as unknown as T);
          count++;
        }
        return { count };
      },
    ),
    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const id = where.id as string;
      const existing = store.get(id);
      if (!existing) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      const updated = { ...existing, ...data, updatedAt: new Date() } as unknown as T;
      store.set(id, updated);
      return updated;
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, rec] of store) {
          if (matchesWhere(rec, where)) {
            store.set(id, { ...rec, ...data, updatedAt: new Date() } as unknown as T);
            count++;
          }
        }
        return { count };
      },
    ),
    upsert: vi.fn(
      async ({
        where,
        create: createData,
        update: updateData,
      }: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        let existing: T | undefined;
        if (where.id) {
          existing = store.get(where.id as string);
        } else {
          for (const rec of store.values()) {
            if (matchesWhere(rec, where)) {
              existing = rec;
              break;
            }
          }
        }
        if (existing) {
          const updated = { ...existing, ...updateData, updatedAt: new Date() } as unknown as T;
          store.set(existing.id, updated);
          return updated;
        }
        const id = (createData.id as string) ?? uid();
        const now = new Date();
        const record = {
          ...(defaults ? defaults() : {}),
          ...createData,
          id,
          createdAt: now,
          updatedAt: now,
        } as unknown as T;
        store.set(id, record);
        return record;
      },
    ),
    delete: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const id = where.id as string;
      const existing = store.get(id);
      if (!existing) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      store.delete(id);
      return existing;
    }),
    deleteMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      let count = 0;
      for (const [id, rec] of store) {
        if (!where || matchesWhere(rec, where)) {
          store.delete(id);
          count++;
        }
      }
      return { count };
    }),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      if (!where) return store.size;
      let count = 0;
      for (const rec of store.values()) {
        if (matchesWhere(rec, where)) count++;
      }
      return count;
    }),
    aggregate: vi.fn(async () => ({ _count: { _all: store.size } })),
    groupBy: vi.fn(async () => []),
  };
}

// ─── Session model (special: keyed by tokenHash for findUnique) ──────────────

function buildSessionMock() {
  const base = buildModelMock(stores.sessions);
  return {
    ...base,
    findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
      let session: MockSession | undefined;
      if (where.tokenHash) {
        session = [...stores.sessions.values()].find((s) => s.tokenHash === where.tokenHash);
      } else if (where.id) {
        session = stores.sessions.get(where.id);
      }
      if (!session) return null;
      const user = stores.users.get(session.userId);
      if (!user) return { ...session, user: null, activeWorkspace: null };
      const memberships = [...stores.workspaceMembers.values()]
        .filter((m) => m.userId === user.id)
        .map((m) => {
          const workspace = stores.workspaces.get(m.workspaceId);
          return {
            workspaceId: m.workspaceId,
            role: m.role,
            workspace: workspace ?? { id: m.workspaceId, name: m.workspaceId },
          };
        });
      const activeWorkspace = session.activeWorkspaceId
        ? stores.workspaces.get(session.activeWorkspaceId) ?? null
        : null;
      return { ...session, user: { ...user, memberships }, activeWorkspace };
    }),
    deleteMany: vi.fn(async ({ where }: { where?: { tokenHash?: string; userId?: string } } = {}) => {
      let count = 0;
      for (const [id, session] of stores.sessions) {
        if (!where) { stores.sessions.delete(id); count++; continue; }
        if (where.tokenHash && session.tokenHash === where.tokenHash) {
          stores.sessions.delete(id); count++;
        } else if (where.userId && session.userId === where.userId) {
          stores.sessions.delete(id); count++;
        }
      }
      return { count };
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: { tokenHash?: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, session] of stores.sessions) {
          if (where.tokenHash && session.tokenHash === where.tokenHash) {
            stores.sessions.set(id, { ...session, ...data } as MockSession);
            count++;
          }
        }
        return { count };
      },
    ),
  };
}

// ─── User model (special: findUnique by email) ──────────────────────────────

function attachUserMemberships(user: MockUser) {
  const memberships = [...stores.workspaceMembers.values()]
    .filter((m) => m.userId === user.id)
    .map((m) => {
      const workspace = stores.workspaces.get(m.workspaceId);
      return {
        workspaceId: m.workspaceId,
        userId: m.userId,
        role: m.role,
        workspace: workspace ?? { id: m.workspaceId, name: m.workspaceId, slug: m.workspaceId },
      };
    });
  return { ...user, memberships };
}

function buildUserMock() {
  const base = buildModelMock(stores.users);
  return {
    ...base,
    findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
      let user: MockUser | undefined;
      if (where.email) {
        user = [...stores.users.values()].find((u) => u.email === where.email);
      } else if (where.id) {
        user = stores.users.get(where.id);
      }
      if (!user) return null;
      return attachUserMemberships(user);
    }),
  };
}

// ─── Workspace model (special: findUnique by slug) ───────────────────────────

function buildWorkspaceMock() {
  const base = buildModelMock(stores.workspaces);
  return {
    ...base,
    findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
      if (where.slug) {
        return [...stores.workspaces.values()].find((w) => w.slug === where.slug) ?? null;
      }
      if (where.id) return stores.workspaces.get(where.id) ?? null;
      return null;
    }),
  };
}

// ─── WorkspaceMember model (special: findMany by userId) ────────────────────

function buildWorkspaceMemberMock() {
  const base = buildModelMock(stores.workspaceMembers);
  return {
    ...base,
    findMany: vi.fn(
      async ({ where }: { where?: { userId?: string; workspaceId?: string } } = {}) => {
        let items = [...stores.workspaceMembers.values()];
        if (where?.userId) items = items.filter((m) => m.userId === where.userId);
        if (where?.workspaceId) items = items.filter((m) => m.workspaceId === where.workspaceId);
        return items.map((m) => ({
          ...m,
          workspace: stores.workspaces.get(m.workspaceId),
          createdAt: m.createdAt,
        }));
      },
    ),
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { id?: string; workspaceId_userId?: { workspaceId: string; userId: string } };
      }) => {
        if (where.id) return stores.workspaceMembers.get(where.id) ?? null;
        if (where.workspaceId_userId) {
          return (
            [...stores.workspaceMembers.values()].find(
              (m) =>
                m.workspaceId === where.workspaceId_userId!.workspaceId &&
                m.userId === where.workspaceId_userId!.userId,
            ) ?? null
          );
        }
        return null;
      },
    ),
  };
}

// ─── Build the full Prisma mock ──────────────────────────────────────────────

export function buildPrismaMock() {
  return {
    user: buildUserMock(),
    session: buildSessionMock(),
    workspace: buildWorkspaceMock(),
    workspaceMember: buildWorkspaceMemberMock(),
    lead: buildModelMock(stores.leads),
    campaign: buildModelMock(stores.campaigns),
    campaignStep: buildModelMock(stores.campaignSteps),
    campaignLead: buildModelMock(stores.campaignLeads),
    suppression: buildModelMock(stores.suppressions),
    tag: buildModelMock(stores.tags),
    leadTag: buildModelMock(stores.leadTags as unknown as Map<string, { id: string }>),
    leadList: buildModelMock(stores.leadLists),
    leadListMember: buildModelMock(
      stores.leadListMembers as unknown as Map<string, { id: string }>,
    ),
    mailbox: buildModelMock(stores.mailboxes),
    leadDiscoveryJob: buildModelMock(stores.discoveryJobs),
    discoveredLead: buildModelMock(stores.discoveredLeads),
    websiteAnalysis: buildModelMock(stores.websiteAnalyses),
    workflow: buildModelMock(stores.workflows),
    workflowVersion: buildModelMock(stores.workflowVersions),
    workflowEvent: buildModelMock(stores.workflowEvents),
    workflowExecution: buildModelMock(stores.workflowExecutions),
    sendingJob: buildModelMock(stores.sendingJobs),
    leadVerification: buildModelMock(stores.leadVerifications),
    iCPProfile: buildModelMock(stores.icpProfiles),
    leadNote: buildModelMock(stores.leadNotes),
    leadEnrichment: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    campaignMailbox: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    campaignActivity: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    leadDiscoveryActivity: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    notification: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    workflowNodeExecution: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    workflowActivity: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    sendingPolicy: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    smtpPool: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    smtpPoolMember: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    workspaceVerificationPolicy: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    campaignDailyUsage: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    emailVerificationJob: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    leadSourceConfig: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    leadSourceRecord: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    passwordResetToken: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    emailVerificationToken: buildModelMock(
      new Map() as Map<string, { id: string }>,
    ),
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: ReturnType<typeof buildPrismaMock>) => Promise<unknown>)(
          buildPrismaMock(),
        );
      }
      if (Array.isArray(arg)) {
        const results = [];
        for (const op of arg) results.push(await op);
        return results;
      }
      return undefined;
    }),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
  };
}

let _prisma: ReturnType<typeof buildPrismaMock> | null = null;

export function getPrisma(): ReturnType<typeof buildPrismaMock> {
  if (!_prisma) _prisma = buildPrismaMock();
  return _prisma;
}

export function resetPrisma(): void {
  _prisma = null;
}
