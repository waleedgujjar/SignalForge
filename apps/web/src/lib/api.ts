/** Same-origin proxy (/api → API server) so session cookies work reliably in the browser. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

const REQUEST_TIMEOUT_MS = 15_000;

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please check that the API is running and try again.');
    }
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('Import payload is too large. Try importing fewer rows at a time.');
    }
    const error = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  timestamp: string;
  version?: string;
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerifiedAt?: string | null;
  };
  workspace?: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  role?: MemberRole | null;
  needsOnboarding: boolean;
}

export type MailboxStatus =
  | 'UNVERIFIED'
  | 'ACTIVE'
  | 'DISABLED'
  | 'PAUSED'
  | 'ERROR'
  | 'DISCONNECTED';

export type MailboxHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type MailboxEncryption = 'NONE' | 'TLS' | 'SSL';
export type SmtpErrorCategory =
  | 'AUTH_FAILED'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'TLS_FAILED'
  | 'PROVIDER_REJECTED'
  | 'UNKNOWN';

export type MailboxEligibilityReason =
  | 'ELIGIBLE'
  | 'UNVERIFIED'
  | 'DISABLED'
  | 'PAUSED'
  | 'ERROR'
  | 'DISCONNECTED'
  | 'UNHEALTHY'
  | 'DAILY_LIMIT_EXHAUSTED'
  | 'MISSING_CREDENTIALS';

export interface Mailbox {
  id: string;
  provider: string;
  name: string | null;
  emailAddress: string;
  fromName: string;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  encryptionType: MailboxEncryption;
  status: MailboxStatus;
  dailySendingLimit: number;
  currentDailyUsage: number;
  remainingToday: number;
  timezone: string | null;
  healthStatus: MailboxHealthStatus;
  healthScore: number | null;
  warmupStatus: string;
  verifiedAt: string | null;
  lastTestedAt: string | null;
  lastSuccessfulSendAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  assignedCampaigns?: { id: string; name: string; status: string }[];
  eligibility?: {
    eligible: boolean;
    reason: MailboxEligibilityReason | string;
    message: string;
    remainingToday: number;
  };
  usage?: {
    dailySendingLimit: number;
    sentToday: number;
    remainingToday: number;
    usageDate: string;
    timezone: string;
  };
  inboundEnabled?: boolean;
  inboundStatus?: string;
  lastInboundSyncAt?: string | null;
  lastInboundError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxConnectionTestRecord {
  id: string;
  status: 'SUCCESS' | 'FAILED';
  errorCategory: SmtpErrorCategory | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MailboxTestOutcome {
  success: boolean;
  message: string;
  errorCategory?: SmtpErrorCategory;
  metadata: { host: string; port: number; encryption: MailboxEncryption };
}

export interface MailboxListQuery {
  status?: MailboxStatus;
  healthStatus?: MailboxHealthStatus;
  search?: string;
  eligibleOnly?: boolean;
}

export interface BulkMailboxResult {
  succeeded: number;
  failed: number;
  skipped: number;
  results: { id: string; success: boolean; error?: string }[];
}

export interface CampaignStep {
  id: string;
  campaignId: string;
  order: number;
  type: string;
  delayDays: number;
  delayAmount: number;
  delayUnit: 'MINUTES' | 'HOURS' | 'DAYS';
  subjectTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface CampaignActivity {
  id: string;
  campaignId: string;
  type: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorUserId?: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  rotationStrategy: string;
  sendingMode?: 'MAILBOX_LIST' | 'SMTP_POOL' | 'SINGLE_MAILBOX';
  smtpPoolId?: string | null;
  mailboxId?: string | null;
  smtpPool?: {
    id: string;
    name: string;
    enabled: boolean;
    strategy: string;
    _count?: { members: number };
  } | null;
  singleMailbox?: Mailbox | null;
  dailySendingLimit?: number | null;
  scheduleConfig?: Record<string, unknown>;
  duplicateEnrollmentPolicy?: string;
  replyHandlingPolicy?: ReplyHandlingPolicy;
  followUpsEnabled?: boolean;
  maxFollowUps?: number;
  launchedAt?: string | null;
  scheduledAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  steps?: CampaignStep[];
  campaignLeads?: { id: string; leadId: string; lead: Lead }[];
  mailboxes?: { mailbox: Mailbox }[];
  _count?: { campaignLeads: number; steps: number; mailboxes: number; activities?: number };
}

export interface CampaignValidationResult {
  valid: boolean;
  ready: boolean;
  checks: { id: string; label: string; passed: boolean; severity: string; message?: string }[];
  errors: string[];
  warnings: string[];
}

export interface EligibilityReport {
  eligible: { leadId: string; email: string; eligible: boolean; reasons: string[] }[];
  ineligible: { leadId: string; email: string; eligible: boolean; reasons: string[] }[];
  suppressed: { leadId: string; email: string; eligible: boolean; reasons: string[] }[];
  alreadyEnrolled: { leadId: string; email: string; eligible: boolean; reasons: string[] }[];
  counts: {
    total: number;
    eligible: number;
    ineligible: number;
    suppressed: number;
    alreadyEnrolled: number;
  };
}

export interface CampaignExecutionJob {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  sequenceStepId: string;
  scheduledAt: string;
  workspaceId: string;
}

export type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'REPLIED' | 'QUALIFIED' | 'UNQUALIFIED'
  | 'CONVERTED' | 'UNSUBSCRIBED' | 'BOUNCED' | 'ARCHIVED';

export type LeadSource = 'MANUAL' | 'CSV_IMPORT' | 'GOOGLE_DRIVE' | 'DISCOVERY' | 'API' | 'OTHER';

export interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { leads: number };
}

export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  _count?: { members: number };
}

export interface LeadNote {
  id: string;
  leadId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  company: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  industry: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  state: string | null;
  city: string | null;
  website: string | null;
  icpScore: number | null;
  status: LeadStatus;
  source: LeadSource;
  customFields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  verification?: { status: string; score: number; reason?: string | null } | null;
  campaignLeads?: { campaign: { id: string; name: string; status: string } }[];
  tags?: { tag: Tag }[];
  listMembers?: { list: { id: string; name: string } }[];
  notes?: LeadNote[];
  enrichment?: {
    id: string;
    status: string;
    prospectScore: number | null;
    icpFitScore: number | null;
    prospectPriority: string | null;
    seniority: string | null;
  } | null;
}

export interface Suppression {
  id: string;
  type: string;
  value: string;
  reason: string;
  source: string;
  createdAt: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch('/health', { cache: 'no-store' });
}

export async function login(email: string, password: string): Promise<SessionResponse> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function signup(data: {
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
}): Promise<SessionResponse> {
  return apiFetch('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchSession(): Promise<SessionResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/auth/session`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 401) return null;
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
      throw new Error(error.error ?? `HTTP ${response.status}`);
    }

    return response.json() as Promise<SessionResponse>;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Session check timed out. Please refresh the page.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export async function completeOnboarding(data: {
  workspaceName: string;
  primaryUseCase?: string;
}): Promise<SessionResponse> {
  return apiFetch('/workspaces/onboarding', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  return apiFetch('/workspaces');
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  return apiFetch('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function switchWorkspace(workspaceId: string): Promise<SessionResponse> {
  return apiFetch('/workspaces/switch', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
}

export async function fetchMailboxes(query?: MailboxListQuery): Promise<Mailbox[]> {
  const params = new URLSearchParams();
  if (query?.status) params.set('status', query.status);
  if (query?.healthStatus) params.set('healthStatus', query.healthStatus);
  if (query?.search) params.set('search', query.search);
  if (query?.eligibleOnly) params.set('eligibleOnly', 'true');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/mailboxes${suffix}`);
}

export async function fetchMailbox(id: string): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}`);
}

export async function createMailbox(data: Record<string, unknown>): Promise<Mailbox> {
  return apiFetch('/mailboxes', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMailbox(id: string, data: Record<string, unknown>): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function testMailboxConnection(data: {
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  encryptionType: MailboxEncryption;
  emailAddress: string;
  fromName: string;
}): Promise<MailboxTestOutcome> {
  return apiFetch('/mailboxes/test-connection', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function testMailbox(id: string): Promise<MailboxTestOutcome> {
  return apiFetch(`/mailboxes/${id}/test`, { method: 'POST' });
}

export async function fetchMailboxTestHistory(
  id: string,
  params?: { page?: number; limit?: number },
): Promise<{ items: MailboxConnectionTestRecord[]; total: number; page: number; limit: number }> {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.limit) search.set('limit', String(params.limit));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch(`/mailboxes/${id}/test-history${suffix}`);
}

export async function enableMailbox(id: string): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}/enable`, { method: 'POST' });
}

export async function disableMailbox(id: string): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}/disable`, { method: 'POST' });
}

export async function pauseMailbox(id: string): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}/pause`, { method: 'POST' });
}

export async function resumeMailbox(id: string): Promise<Mailbox> {
  return apiFetch(`/mailboxes/${id}/resume`, { method: 'POST' });
}

export async function bulkMailboxAction(data: {
  mailboxIds: string[];
  action: 'ENABLE' | 'DISABLE';
}): Promise<BulkMailboxResult> {
  return apiFetch('/mailboxes/bulk', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchMailboxEligibility(id: string): Promise<{
  mailboxId: string;
  eligible: boolean;
  reason: MailboxEligibilityReason | string;
  message: string;
  remainingToday: number;
}> {
  return apiFetch(`/mailboxes/${id}/eligibility`);
}

export async function fetchEligibleMailboxes(): Promise<Mailbox[]> {
  return fetchMailboxes({ eligibleOnly: true });
}

export async function deleteMailbox(id: string): Promise<void> {
  return apiFetch(`/mailboxes/${id}`, { method: 'DELETE' });
}

export async function fetchCampaigns(params?: Record<string, string>): Promise<{
  data: Campaign[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/campaigns${query}`);
}

export async function fetchCampaign(id: string): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}`);
}

export async function createCampaign(data: Record<string, unknown>): Promise<Campaign> {
  return apiFetch('/campaigns', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCampaign(id: string, data: Record<string, unknown>): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteCampaign(id: string): Promise<void> {
  return apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}/pause`, { method: 'POST' });
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}/resume`, { method: 'POST' });
}

export async function stopCampaign(id: string, data: { confirmed: true; reason?: string }): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}/stop`, { method: 'POST', body: JSON.stringify(data) });
}

export async function launchCampaign(id: string): Promise<{
  success: boolean;
  campaign?: Campaign;
  validation?: CampaignValidationResult;
}> {
  return apiFetch(`/campaigns/${id}/launch`, { method: 'POST', body: JSON.stringify({}) });
}

export async function activateCampaign(id: string): Promise<{
  ready: boolean;
  campaign?: Campaign;
  validation?: CampaignValidationResult;
  issues?: string[];
}> {
  return apiFetch(`/campaigns/${id}/activate`, { method: 'POST' });
}

export async function validateCampaign(id: string): Promise<CampaignValidationResult> {
  return apiFetch(`/campaigns/${id}/validate`, { method: 'POST', body: JSON.stringify({}) });
}

export async function enrollCampaignLeads(
  id: string,
  data: { leadIds: string[]; force?: boolean },
): Promise<{ enrolled: number; skipped: number; eligibility: EligibilityReport }> {
  return apiFetch(`/campaigns/${id}/leads`, { method: 'POST', body: JSON.stringify(data) });
}

export async function removeCampaignLead(campaignId: string, leadId: string): Promise<void> {
  return apiFetch(`/campaigns/${campaignId}/leads/${leadId}`, { method: 'DELETE' });
}

export async function updateCampaignLeadOverride(
  campaignId: string,
  leadId: string,
  data: { subjectOverride?: string | null; bodyOverride?: string | null },
): Promise<{ id: string; subjectOverride: string | null; bodyOverride: string | null }> {
  return apiFetch(`/campaigns/${campaignId}/leads/${leadId}/override`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function previewCampaignEligibility(
  id: string,
  leadIds: string[],
): Promise<EligibilityReport> {
  return apiFetch(`/campaigns/${id}/leads/preview-eligibility`, {
    method: 'POST',
    body: JSON.stringify({ leadIds }),
  });
}

export async function seedCampaignFollowUps(
  campaignId: string,
  maxFollowUps = 5,
): Promise<{ steps: CampaignStep[] }> {
  return apiFetch(`/campaigns/${campaignId}/follow-ups/seed`, {
    method: 'POST',
    body: JSON.stringify({ maxFollowUps }),
  });
}

export interface LeadSequenceStepView {
  stepId: string;
  order: number;
  label: string;
  subjectTemplate: string;
  delayAmount: number;
  delayUnit: string;
  enabled: boolean;
  jobStatus: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  state: 'sent' | 'scheduled' | 'pending' | 'cancelled' | 'failed' | 'skipped';
}

export interface LeadSequenceStatus {
  campaignId: string;
  leadId: string;
  campaignLeadId: string;
  leadName: string | null;
  leadEmail: string;
  campaignName: string;
  status: string;
  stopReason: string | null;
  stoppedAt: string | null;
  currentStepOrder: number;
  followUpsEnabled: boolean;
  maxFollowUps: number;
  steps: LeadSequenceStepView[];
}

export async function fetchLeadSequenceStatus(
  campaignId: string,
  leadId: string,
): Promise<LeadSequenceStatus> {
  return apiFetch(`/campaigns/${campaignId}/leads/${leadId}/sequence`);
}

export async function createCampaignStep(
  campaignId: string,
  data: Record<string, unknown>,
): Promise<CampaignStep> {
  return apiFetch(`/campaigns/${campaignId}/steps`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCampaignStep(
  campaignId: string,
  stepId: string,
  data: Record<string, unknown>,
): Promise<CampaignStep> {
  return apiFetch(`/campaigns/${campaignId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCampaignStep(campaignId: string, stepId: string): Promise<void> {
  return apiFetch(`/campaigns/${campaignId}/steps/${stepId}`, { method: 'DELETE' });
}

export async function reorderCampaignSteps(
  campaignId: string,
  orderedStepIds: string[],
): Promise<{ steps: CampaignStep[] }> {
  return apiFetch(`/campaigns/${campaignId}/steps/reorder`, {
    method: 'POST',
    body: JSON.stringify({ orderedStepIds }),
  });
}

export async function duplicateCampaignStep(
  campaignId: string,
  stepId: string,
): Promise<CampaignStep> {
  return apiFetch(`/campaigns/${campaignId}/steps/${stepId}/duplicate`, { method: 'POST' });
}

export async function fetchCampaignActivity(
  id: string,
  params?: Record<string, string>,
): Promise<{
  data: CampaignActivity[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/campaigns/${id}/activity${query}`);
}

export async function fetchCampaignExecutionPlan(id: string): Promise<{
  jobs: CampaignExecutionJob[];
  count: number;
}> {
  return apiFetch(`/campaigns/${id}/execution-plan`);
}

export async function previewCampaignEmail(
  campaignId: string,
  data: {
    subjectTemplate: string;
    bodyTemplate: string;
    leadId: string;
    seed?: number;
    variationCount?: number;
  },
): Promise<{
  leadId?: string;
  subject?: string;
  body?: string;
  valid?: boolean;
  variations?: { subject: string; body: string; seed: number; valid: boolean }[];
}> {
  return apiFetch(`/campaigns/${campaignId}/preview`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchLeads(params?: Record<string, string>): Promise<{
  data: Lead[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/leads${query}`);
}

export async function createLead(data: Record<string, unknown>): Promise<Lead> {
  return apiFetch('/leads', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchLead(id: string): Promise<Lead> {
  return apiFetch(`/leads/${id}`);
}

export async function updateLead(id: string, data: Record<string, unknown>): Promise<Lead> {
  return apiFetch(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteLead(id: string): Promise<void> {
  return apiFetch(`/leads/${id}`, { method: 'DELETE' });
}

export async function bulkDeleteLeads(leadIds: string[]): Promise<{ deleted: number }> {
  return apiFetch('/leads/bulk/delete', { method: 'POST', body: JSON.stringify({ leadIds }) });
}

export async function bulkTagLeads(leadIds: string[], tagIds: string[]): Promise<{ tagged: number }> {
  return apiFetch('/leads/bulk/tag', { method: 'POST', body: JSON.stringify({ leadIds, tagIds }) });
}

export async function bulkAddToList(leadIds: string[], listId: string): Promise<{ added: number }> {
  return apiFetch('/leads/bulk/list', { method: 'POST', body: JSON.stringify({ leadIds, listId }) });
}

export async function bulkUpdateStatus(leadIds: string[], status: LeadStatus): Promise<{ updated: number }> {
  return apiFetch('/leads/bulk/status', { method: 'POST', body: JSON.stringify({ leadIds, status }) });
}

const IMPORT_BATCH_SIZE = 500;

function trimImportRows(
  rows: Record<string, string>[],
  mappings: Record<string, string>,
): Record<string, string>[] {
  const mappedColumns = Object.keys(mappings).filter((column) => mappings[column]);
  return rows.map((row) => {
    const trimmed: Record<string, string> = {};
    for (const column of mappedColumns) {
      trimmed[column] = row[column] ?? '';
    }
    return trimmed;
  });
}

function offsetImportErrors(errors: string[], rowOffset: number): string[] {
  if (rowOffset === 0) return errors;
  return errors.map((error) => {
    const match = error.match(/^Row (\d+):/);
    if (!match) return error;
    return error.replace(/^Row \d+:/, `Row ${Number(match[1]) + rowOffset}:`);
  });
}

export interface ImportLeadsResult {
  created: number;
  skipped: number;
  errors: string[];
  /** PENDING LinkedIn research suggestions created from LinkedIn columns (Module 17). Absent when research is disabled. */
  researchSuggested?: number;
}

export async function importLeads(rows: Record<string, string>[], mappings: Record<string, string>, skipDuplicates: boolean): Promise<ImportLeadsResult> {
  const trimmedRows = trimImportRows(rows, mappings);
  if (trimmedRows.length === 0) {
    throw new Error('No rows to import');
  }

  async function importBatch(
    batch: Record<string, string>[],
    rowOffset = 0,
  ): Promise<ImportLeadsResult> {
    const result = await apiFetch<ImportLeadsResult>('/leads/import', {
      method: 'POST',
      body: JSON.stringify({ rows: batch, mappings, skipDuplicates }),
    });
    return {
      ...result,
      errors: offsetImportErrors(result.errors, rowOffset),
    };
  }

  if (trimmedRows.length <= IMPORT_BATCH_SIZE) {
    return importBatch(trimmedRows);
  }

  let created = 0;
  let skipped = 0;
  let researchSuggested: number | undefined;
  const errors: string[] = [];

  for (let i = 0; i < trimmedRows.length; i += IMPORT_BATCH_SIZE) {
    const batch = trimmedRows.slice(i, i + IMPORT_BATCH_SIZE);
    const result = await importBatch(batch, i);
    created += result.created;
    skipped += result.skipped;
    errors.push(...result.errors);
    if (typeof result.researchSuggested === 'number') {
      researchSuggested = (researchSuggested ?? 0) + result.researchSuggested;
    }
  }

  return researchSuggested === undefined
    ? { created, skipped, errors }
    : { created, skipped, errors, researchSuggested };
}

// ─── Smart Import (server-side parsing, auto column detection) ────────────────

export interface SmartImportSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  noEmail: number;
  invalidEmail: number;
  qualificationQueued: number;
  nameFromOwner: number;
  nameFromCompany: number;
  researchSuggested: number;
  emailDetected?: number;
  phoneDetected?: number;
  websiteDetected?: number;
  ownerDetected?: number;
  companyDetected?: number;
}

export interface SmartImportMapping {
  csvColumn: string;
  leadField: string;
  confidence: number;
  reason?: string;
}

export interface SmartImportFieldStats {
  totalRows: number;
  validRows: number;
  email: number;
  phone: number;
  website: number;
  owner: number;
  company: number;
}

export interface SmartImportPreviewRow {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

export interface SmartImportPreviewResult {
  headers: string[];
  totalRowCount: number;
  detectedMappings: SmartImportMapping[];
  unmappedColumns: string[];
  fieldStats: SmartImportFieldStats;
  previewRows: SmartImportPreviewRow[];
  skipped: number;
  errors: SmartImportError[];
}

export interface SmartImportError {
  row: number;
  message: string;
}

export interface SmartImportResult {
  importId?: string;
  createdLeadIds?: string[];
  summary: SmartImportSummary;
  mappings: SmartImportMapping[];
  errors: SmartImportError[];
}

async function uploadSmartImportFile(
  endpoint: string,
  file: File,
  options?: { mergeStrategy?: 'skip' | 'fill_missing'; mappings?: Record<string, string> },
): Promise<Response> {
  const formData = new FormData();
  formData.append('file', file);
  if (options) {
    formData.append('options', JSON.stringify(options));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    return await fetch(`${API_URL}/leads/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Import timed out. The file may be too large.');
    }
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function previewSmartImport(
  file: File,
  mappings?: Record<string, string>,
): Promise<SmartImportPreviewResult> {
  const response = await uploadSmartImportFile('smart-import/preview', file, { mappings });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(err.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export async function smartImportLeads(
  file: File,
  options?: { mergeStrategy?: 'skip' | 'fill_missing'; mappings?: Record<string, string> },
): Promise<SmartImportResult> {
  const response = await uploadSmartImportFile('smart-import', file, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(err.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export function getExportUrl(params?: Record<string, string>): string {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `${API_BASE}/leads/export${query}`;
}

// Tags
export async function fetchTags(): Promise<Tag[]> {
  return apiFetch('/leads/tags');
}

export async function createTag(data: { name: string; color?: string }): Promise<Tag> {
  return apiFetch('/leads/tags', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteTag(id: string): Promise<void> {
  return apiFetch(`/leads/tags/${id}`, { method: 'DELETE' });
}

export async function addTagsToLead(leadId: string, tagIds: string[]): Promise<{ added: number }> {
  return apiFetch(`/leads/${leadId}/tags`, { method: 'POST', body: JSON.stringify({ tagIds }) });
}

export async function removeTagFromLead(leadId: string, tagId: string): Promise<void> {
  return apiFetch(`/leads/${leadId}/tags/${tagId}`, { method: 'DELETE' });
}

// Lists
export async function fetchLists(): Promise<LeadList[]> {
  return apiFetch('/leads/lists');
}

export async function createList(data: { name: string; description?: string }): Promise<LeadList> {
  return apiFetch('/leads/lists', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteList(id: string): Promise<void> {
  return apiFetch(`/leads/lists/${id}`, { method: 'DELETE' });
}

export async function addLeadsToList(listId: string, leadIds: string[]): Promise<{ added: number }> {
  return apiFetch(`/leads/lists/${listId}/members`, { method: 'POST', body: JSON.stringify({ leadIds }) });
}

export async function removeLeadFromList(listId: string, leadId: string): Promise<void> {
  return apiFetch(`/leads/lists/${listId}/members/${leadId}`, { method: 'DELETE' });
}

// Lead Notes
export async function fetchLeadNotes(leadId: string): Promise<LeadNote[]> {
  return apiFetch(`/leads/${leadId}/notes`);
}

export async function createLeadNote(leadId: string, content: string): Promise<LeadNote> {
  return apiFetch(`/leads/${leadId}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
}

export async function deleteLeadNote(leadId: string, noteId: string): Promise<void> {
  return apiFetch(`/leads/${leadId}/notes/${noteId}`, { method: 'DELETE' });
}

export async function fetchSuppressions(): Promise<Suppression[]> {
  return apiFetch('/suppressions');
}

export async function createSuppression(data: {
  type: 'EMAIL' | 'DOMAIN';
  value: string;
  reason?: string;
}): Promise<Suppression> {
  return apiFetch('/suppressions', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteSuppression(id: string): Promise<void> {
  return apiFetch(`/suppressions/${id}`, { method: 'DELETE' });
}

export async function verifyEmail(email: string, options?: { leadId?: string; forceRecheck?: boolean }): Promise<{
  email: string;
  status: string;
  statusLabel?: string;
  score: number;
  riskScore?: number;
  confidenceScore?: number;
  reason: string;
  reasonCode?: string;
  domain?: string;
  mxStatus?: string;
}> {
  return apiFetch('/verification/check', {
    method: 'POST',
    body: JSON.stringify({ email, ...options }),
  });
}

export interface EmailVerificationJob {
  id: string;
  status: string;
  source: string;
  name: string | null;
  total: number;
  pending: number;
  completed: number;
  validCount: number;
  invalidCount: number;
  riskyCount: number;
  unknownCount: number;
  disposableCount: number;
  roleCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface EmailVerificationHistoryEntry {
  id: string;
  email: string;
  normalizedEmail: string;
  status: string;
  riskScore: number | null;
  confidenceScore: number | null;
  reasonMessage: string | null;
  checkedAt: string;
  jobId: string | null;
  leadId: string | null;
}

export async function createVerificationBulkJob(input: {
  emails?: string[];
  leadIds?: string[];
  name?: string;
  source?: string;
}): Promise<{ jobId: string; status: string; total: number }> {
  return apiFetch('/verification/bulk', { method: 'POST', body: JSON.stringify(input) });
}

export async function fetchVerificationJobs(params?: { page?: number; limit?: number }): Promise<{
  data: EmailVerificationJob[];
  total: number;
  page: number;
  limit: number;
}> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch(`/verification/jobs${suffix}`);
}

export async function fetchVerificationJob(jobId: string): Promise<EmailVerificationJob> {
  return apiFetch(`/verification/jobs/${jobId}`);
}

export async function cancelVerificationJob(jobId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/verification/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function fetchVerificationHistory(params?: {
  page?: number;
  limit?: number;
  status?: string;
  jobId?: string;
  search?: string;
}): Promise<{ data: EmailVerificationHistoryEntry[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  if (params?.jobId) query.set('jobId', params.jobId);
  if (params?.search) query.set('search', params.search);
  return apiFetch(`/verification/history?${query.toString()}`);
}

export async function recheckLeadVerification(leadId: string) {
  return apiFetch(`/verification/${leadId}/recheck`, { method: 'POST' });
}

export async function uploadVerificationExcel(input: {
  file: { data: string; mimeType: string; filename?: string };
  emailColumn?: string;
  name?: string;
}): Promise<{ jobId: string; status: string; total: number; emailColumn: string }> {
  return apiFetch('/verification/excel', { method: 'POST', body: JSON.stringify(input) });
}

export function verificationExportUrl(jobId: string): string {
  return `${API_URL}/verification/export/${jobId}`;
}

// Workspace settings
export interface WorkspaceDetails {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  timezone: string;
  defaultFromName: string | null;
  defaultReplyTo: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  role: MemberRole;
}

export async function fetchWorkspaceDetails(): Promise<WorkspaceDetails> {
  return apiFetch('/workspaces/current');
}

export async function updateWorkspaceSettings(data: {
  name?: string;
  timezone?: string;
  defaultFromName?: string | null;
  defaultReplyTo?: string | null;
  logoUrl?: string | null;
}): Promise<WorkspaceDetails> {
  return apiFetch('/workspaces/current', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// User profile
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: MemberRole | null;
  workspace: { id: string; name: string; slug: string } | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProfile(): Promise<UserProfile> {
  return apiFetch('/users/profile');
}

export async function updateProfile(data: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<UserProfile> {
  return apiFetch('/users/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function previewEmail(
  campaignId: string,
  data: { subjectTemplate: string; bodyTemplate: string; leadId: string },
): Promise<{ subject: string; body: string; valid: boolean }> {
  return apiFetch(`/campaigns/${campaignId}/preview`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Integrations
export type IntegrationProvider = 'GOOGLE_DRIVE';
export type IntegrationStatus = 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR';

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountEmail: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchIntegrations(): Promise<Integration[]> {
  return apiFetch('/integrations');
}

export async function connectIntegration(provider: IntegrationProvider): Promise<{ authUrl: string }> {
  return apiFetch('/integrations/connect', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export async function disconnectIntegration(id: string): Promise<void> {
  return apiFetch(`/integrations/${id}`, { method: 'DELETE' });
}

// Drive Import
export interface CloudFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

export interface CloudFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  iconUrl?: string;
}

export interface ColumnMapping {
  csvColumn: string;
  leadField: string | null;
  confidence: number;
}

export interface FilePreview {
  headers: string[];
  rows: Record<string, string>[];
  totalRowCount: number;
  suggestedMappings: ColumnMapping[];
  previouslyImported: boolean;
  lastImportedAt: string | null;
}

export type ImportStatus = 'PENDING' | 'SCANNING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ImportFileStatus {
  id: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceFileMimeType: string;
  importedRowCount: number | null;
  skippedRowCount: number | null;
  errorRowCount: number | null;
  status: ImportStatus;
}

export interface LeadImportSummary {
  id: string;
  source: LeadSource;
  status: ImportStatus;
  totalFiles: number;
  totalRows: number | null;
  importedCount: number | null;
  skippedCount: number | null;
  duplicateCount: number | null;
  errorCount: number | null;
  createdAt: string;
  completedAt: string | null;
  files: ImportFileStatus[];
}

export interface ImportProgress {
  status: ImportStatus;
  totalRows: number | null;
  importedCount: number | null;
  skippedCount: number | null;
  duplicateCount: number | null;
  errorCount: number | null;
  /** PENDING LinkedIn research suggestions created from LinkedIn columns (Module 17). Absent when research is disabled. */
  researchSuggested?: number | null;
  completedAt: string | null;
  files: {
    sourceFileName: string;
    status: ImportStatus;
    importedRowCount: number | null;
    skippedRowCount: number | null;
    errorRowCount: number | null;
  }[];
}

export async function fetchDriveFolders(integrationId: string, parentFolderId?: string): Promise<CloudFolder[]> {
  const params = new URLSearchParams({ integrationId });
  if (parentFolderId) params.set('parentFolderId', parentFolderId);
  return apiFetch(`/drive/folders?${params}`);
}

export async function fetchDriveFiles(integrationId: string, folderId: string): Promise<CloudFile[]> {
  const params = new URLSearchParams({ integrationId, folderId });
  return apiFetch(`/drive/files?${params}`);
}

export async function fetchDriveFilePreview(
  integrationId: string,
  fileId: string,
  maxRows?: number,
): Promise<FilePreview> {
  const params = new URLSearchParams({ integrationId });
  if (maxRows) params.set('maxRows', String(maxRows));
  return apiFetch(`/drive/files/${fileId}/preview?${params}`);
}

export async function startDriveImport(data: {
  integrationId: string;
  files: { fileId: string; fileName: string; mimeType: string; size?: number }[];
  mappings: Record<string, string>;
  options: { skipDuplicates?: boolean; tagIds?: string[]; listId?: string };
}): Promise<{ importId: string }> {
  return apiFetch('/drive/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchImportHistory(params?: Record<string, string>): Promise<{
  imports: LeadImportSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/drive/imports${query}`);
}

export async function fetchImportDetail(importId: string): Promise<LeadImportSummary> {
  return apiFetch(`/drive/imports/${importId}`);
}

export async function fetchImportProgress(importId: string): Promise<ImportProgress> {
  return apiFetch(`/drive/imports/${importId}/progress`);
}

// ─── Website Intelligence ─────────────────────────────────────────────────────

export type AnalysisStatus = 'PENDING' | 'CRAWLING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';
export type OpportunityPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface WebsiteAnalysis {
  id: string;
  workspaceId: string;
  leadId: string;
  domain: string;
  url: string;
  status: AnalysisStatus;
  websiteScore: number | null;
  opportunityScore: number | null;
  opportunityPriority: OpportunityPriority | null;
  scoreBreakdown: Record<string, number> | null;
  technicalFindings: Record<string, unknown> | null;
  performanceData: Record<string, unknown> | null;
  seoFindings: Record<string, unknown> | null;
  mobileFindings: Record<string, unknown> | null;
  contentFindings: Record<string, unknown> | null;
  conversionData: Record<string, unknown> | null;
  technologies: Array<{ name: string; category: string; confidence: string }> | null;
  aiSignals: Record<string, unknown> | null;
  modernityAssessment: Record<string, unknown> | null;
  aiSummary: string | null;
  aiKeyIssues: string[] | null;
  aiOpportunities: Array<{ service: string; evidence: string; confidence: string }> | null;
  aiPersonalizationHooks: string[] | null;
  recommendedServices: Array<{ service: string; evidence: string[]; confidence: string; priority: string }> | null;
  pagesCrawled: number;
  crawlDurationMs: number | null;
  errorMessage: string | null;
  analyzedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: { id: string; email: string; fullName: string | null; company: string | null; website?: string | null };
}

export interface WebsiteAnalysisStats {
  totalAnalyzed: number;
  avgWebsiteScore: number;
  avgOpportunityScore: number;
  priorityDistribution: Record<string, number>;
}

export async function analyzeWebsite(data: {
  leadId: string;
  maxPages?: number;
  reanalyze?: boolean;
}): Promise<{ analysisId: string; leadId: string }> {
  return apiFetch('/website-intelligence/analyze', { method: 'POST', body: JSON.stringify(data) });
}

export async function analyzeWebsiteUrl(data: {
  url: string;
  leadId?: string;
  email?: string;
  company?: string;
  maxPages?: number;
  reanalyze?: boolean;
}): Promise<{ analysisId: string; leadId: string }> {
  return apiFetch('/website-intelligence/analyze/url', { method: 'POST', body: JSON.stringify(data) });
}

export async function batchAnalyzeWebsites(data: {
  leadIds: string[];
  maxPages?: number;
  confirmBulk?: boolean;
}): Promise<{ queued: number; skipped: number; skippedLeadIds: string[] }> {
  return apiFetch('/website-intelligence/analyze/batch', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchWebsiteAnalyses(params?: Record<string, string>): Promise<{ analyses: WebsiteAnalysis[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/website-intelligence/analyses${query}`);
}

export async function fetchWebsiteAnalysis(id: string): Promise<WebsiteAnalysis> {
  return apiFetch(`/website-intelligence/analyses/${id}`);
}

export async function fetchLeadWebsiteAnalysis(leadId: string): Promise<WebsiteAnalysis> {
  return apiFetch(`/website-intelligence/lead/${leadId}`);
}

export async function fetchLeadAnalysisHistory(leadId: string): Promise<{ analyses: WebsiteAnalysis[] }> {
  return apiFetch(`/website-intelligence/lead/${leadId}/history`);
}

export async function rescanWebsite(id: string): Promise<{ analysisId: string }> {
  return apiFetch(`/website-intelligence/rescan/${id}`, { method: 'POST' });
}

export async function fetchWebsiteIntelStats(): Promise<WebsiteAnalysisStats> {
  return apiFetch('/website-intelligence/stats');
}

// ─── Lead Enrichment ─────────────────────────────────────────────────────────

export type EnrichmentStatus = 'NOT_ENRICHED' | 'QUEUED' | 'ENRICHING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type ProspectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
export type Seniority = 'EXECUTIVE' | 'VP' | 'DIRECTOR' | 'MANAGER' | 'INDIVIDUAL_CONTRIBUTOR' | 'UNKNOWN';

/** How trustworthy a researched or AI-assessed value is. Never upgraded by the UI. */
export type VerificationState = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
export type AssessmentLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface OpportunityAssessmentEntry {
  value: AssessmentLevel | null;
  status: VerificationState;
  evidence: string[];
}

export interface OpportunityAssessment {
  icpFit: OpportunityAssessmentEntry;
  serviceFit: OpportunityAssessmentEntry;
  aiReceptionistOpportunity: OpportunityAssessmentEntry;
  customerResponseOpportunity: OpportunityAssessmentEntry;
  appointmentBookingOpportunity: OpportunityAssessmentEntry;
  websiteOpportunity: OpportunityAssessmentEntry;
  leadQuality: OpportunityAssessmentEntry;
}

export interface LeadEnrichment {
  id: string;
  leadId: string;
  workspaceId: string;
  status: EnrichmentStatus;
  icpFitScore: number | null;
  icpBreakdown: Record<string, number> | null;
  leadQualityScore: number | null;
  leadQualityBreakdown: Record<string, number> | null;
  prospectScore: number | null;
  prospectBreakdown: Record<string, number> | null;
  prospectPriority: ProspectPriority | null;
  seniority: Seniority | null;
  department: string | null;
  companyProfile: Record<string, unknown> | null;
  aiSummary: string | null;
  painPointHypotheses: { observation: string; hypothesis: string; confidence: string; source: string }[] | null;
  recommendedServices: { service: string; score: number; confidence: string; evidence: string[] }[] | null;
  personalizationHooks: { observation: string; angle: string; confidence: string }[] | null;
  outreachAngles: { angle: string; reasoning: string; evidence: string[]; confidence: string }[] | null;
  dynamicVariables: Record<string, string> | null;
  opportunityAssessment?: OpportunityAssessment | null;
  aiConfidence: string | null;
  enrichedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: { id: string; email: string; firstName: string | null; lastName: string | null; fullName: string | null; company: string | null; jobTitle?: string | null };
}

export interface ICPProfile {
  id?: string;
  targetIndustries: string[];
  targetCountries: string[];
  targetCompanySizes: string[];
  targetJobTitles: string[];
  targetSeniorities: string[];
  targetKeywords: string[];
  minWebsiteScore: number | null;
  minOpportunityScore: number | null;
  requireVerifiedEmail: boolean;
  weights: { industry: number; location: number; companySize: number; jobTitle: number; seniority: number };
}

export interface ServiceCatalogEntry {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  matchingSignals: string[];
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnrichmentStats {
  total: number;
  statusDistribution: Record<string, number>;
  priorityDistribution: Record<string, number>;
  avgProspectScore: number;
  avgICPFitScore: number;
  avgLeadQualityScore: number;
}

export async function enrichLead(leadId: string): Promise<{ enrichmentId: string; status: string; message?: string }> {
  return apiFetch('/lead-enrichment/enrich', { method: 'POST', body: JSON.stringify({ leadId }) });
}

export async function batchEnrichLeads(leadIds: string[]): Promise<{ queued: number; skipped: number; alreadyEnriched: number }> {
  return apiFetch('/lead-enrichment/enrich/batch', { method: 'POST', body: JSON.stringify({ leadIds }) });
}

export async function fetchEnrichments(params?: Record<string, string>): Promise<{ enrichments: LeadEnrichment[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/lead-enrichment/enrichments${query}`);
}

export async function fetchEnrichment(id: string): Promise<LeadEnrichment> {
  return apiFetch(`/lead-enrichment/enrichments/${id}`);
}

export async function fetchLeadEnrichment(leadId: string): Promise<LeadEnrichment> {
  return apiFetch(`/lead-enrichment/lead/${leadId}`);
}

export async function retryEnrichment(id: string): Promise<{ enrichmentId: string; status: string }> {
  return apiFetch(`/lead-enrichment/retry/${id}`, { method: 'POST' });
}

export async function fetchEnrichmentStats(): Promise<EnrichmentStats> {
  return apiFetch('/lead-enrichment/stats');
}

export async function fetchICPProfile(): Promise<ICPProfile> {
  return apiFetch('/lead-enrichment/icp');
}

export async function updateICPProfile(data: Partial<ICPProfile>): Promise<ICPProfile> {
  return apiFetch('/lead-enrichment/icp', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  return apiFetch('/lead-enrichment/services');
}

export async function createService(data: { name: string; description?: string; matchingSignals?: string[]; enabled?: boolean }): Promise<ServiceCatalogEntry> {
  return apiFetch('/lead-enrichment/services', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateService(id: string, data: Partial<{ name: string; description: string; matchingSignals: string[]; enabled: boolean; sortOrder: number }>): Promise<ServiceCatalogEntry> {
  return apiFetch(`/lead-enrichment/services/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteService(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/lead-enrichment/services/${id}`, { method: 'DELETE' });
}

export async function seedServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  return apiFetch('/lead-enrichment/services/seed', { method: 'POST' });
}

// Sending Queue (Module 9)

export type SendingJobStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

export type SendErrorCategory =
  | 'TEMPORARY'
  | 'PERMANENT'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'CONNECTION'
  | 'BOUNCE'
  | 'INVALID_ADDRESS'
  | 'UNKNOWN';

export interface SendingJob {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  sequenceStepId: string;
  mailboxId: string | null;
  scheduledAt: string;
  status: SendingJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorCategory: SendErrorCategory | null;
  lastError: string | null;
  bullmqJobId: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  pausedAt: string | null;
  providerMessageId: string | null;
  emailMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  campaign?: { id: string; name: string };
  lead?: { id: string; email: string; firstName: string | null; lastName: string | null; company: string | null };
  mailbox?: { id: string; emailAddress: string; fromName: string } | null;
  step?: { id: string; order: number; subjectTemplate: string };
}

export interface SendingJobListQuery {
  page?: number;
  limit?: number;
  campaignId?: string;
  status?: SendingJobStatus | SendingJobStatus[];
  mailboxId?: string;
  leadId?: string;
  errorCategory?: SendErrorCategory;
  from?: string;
  to?: string;
  search?: string;
}

export interface SendingJobListResponse {
  data: SendingJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface QueueStats {
  counts: Record<SendingJobStatus, number>;
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
}

export interface CampaignSendingStats {
  counts: Record<SendingJobStatus, number>;
  total: number;
  pending: number;
  sent: number;
  failed: number;
  cancelled: number;
  dailyLimit: number | null;
  sentToday: number;
  timezone: string;
}

export async function fetchSendingJobs(query: SendingJobListQuery = {}): Promise<SendingJobListResponse> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return apiFetch(`/sending/jobs${qs ? `?${qs}` : ''}`);
}

export async function fetchSendingJob(id: string): Promise<SendingJob> {
  return apiFetch(`/sending/jobs/${id}`);
}

export async function fetchQueueStats(): Promise<QueueStats> {
  return apiFetch('/sending/queue/stats');
}

export async function retrySendingJob(id: string): Promise<SendingJob> {
  return apiFetch(`/sending/jobs/${id}/retry`, { method: 'POST' });
}

export async function cancelSendingJob(id: string): Promise<SendingJob> {
  return apiFetch(`/sending/jobs/${id}/cancel`, { method: 'POST' });
}

export async function fetchCampaignSendingStats(campaignId: string): Promise<CampaignSendingStats> {
  return apiFetch(`/campaigns/${campaignId}/sending-stats`);
}

// ─── Module 10: SMTP Pools & Rotation ─────────────────────────────────────────

export type RotationStrategy =
  | 'ROUND_ROBIN'
  | 'LEAST_UTILIZED'
  | 'HEALTH_AWARE'
  | 'CAMPAIGN_SPECIFIC'
  | 'CAPACITY_BASED';

export type CampaignSendingMode = 'MAILBOX_LIST' | 'SMTP_POOL' | 'SINGLE_MAILBOX';

export type DegradedMailboxPolicy = 'ALLOW' | 'DEPRIORITIZE' | 'EXCLUDE';

export interface SmtpPoolMemberSummary {
  id: string;
  mailboxId: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  mailbox: {
    id: string;
    emailAddress: string;
    fromName: string;
    status: string;
    healthStatus: string;
    dailySendingLimit: number;
    currentDailyUsage: number;
    verifiedAt?: string | null;
  };
}

export interface SmtpPool {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  strategy: RotationStrategy;
  enabled: boolean;
  lastRoundRobinMailboxId: string | null;
  createdAt: string;
  updatedAt: string;
  members: SmtpPoolMemberSummary[];
}

export interface CreateSmtpPoolInput {
  name: string;
  description?: string | null;
  strategy?: RotationStrategy;
  enabled?: boolean;
}

export type UpdateSmtpPoolInput = Partial<CreateSmtpPoolInput>;

export interface AddPoolMemberInput {
  mailboxId: string;
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePoolMemberInput {
  priority?: number;
  enabled?: boolean;
}

export interface SmtpPoolHealth {
  poolId: string;
  enabled: boolean;
  total: number;
  enabledMembers: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  capacityToday: number;
}

export interface RotationSettings {
  id: string;
  workspaceId: string;
  rotationStrategy: RotationStrategy;
  enabled: boolean;
  degradedMailboxPolicy: DegradedMailboxPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRotationSettingsInput {
  rotationStrategy?: RotationStrategy;
  enabled?: boolean;
  degradedMailboxPolicy?: DegradedMailboxPolicy;
}

export interface RotationStatsPool {
  id: string;
  name: string;
  enabled: boolean;
  strategy: RotationStrategy;
  memberCount: number;
  enabledMemberCount: number;
  capacityToday: number;
}

export interface RotationStats {
  totalCapacity: number;
  usedCapacity: number;
  remainingCapacity: number;
  pools: RotationStatsPool[];
  allocationsToday: Array<{ mailboxId: string; allocated: number; failures: number }>;
}

export async function fetchSmtpPools(): Promise<SmtpPool[]> {
  return apiFetch('/smtp-pools');
}

export async function fetchSmtpPool(id: string): Promise<SmtpPool> {
  return apiFetch(`/smtp-pools/${id}`);
}

export async function createSmtpPool(data: CreateSmtpPoolInput): Promise<SmtpPool> {
  return apiFetch('/smtp-pools', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSmtpPool(id: string, data: UpdateSmtpPoolInput): Promise<SmtpPool> {
  return apiFetch(`/smtp-pools/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteSmtpPool(id: string): Promise<void> {
  await apiFetch(`/smtp-pools/${id}`, { method: 'DELETE' });
}

export async function addSmtpPoolMember(
  poolId: string,
  data: AddPoolMemberInput,
): Promise<SmtpPoolMemberSummary> {
  return apiFetch(`/smtp-pools/${poolId}/accounts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSmtpPoolMember(
  poolId: string,
  mailboxId: string,
  data: UpdatePoolMemberInput,
): Promise<SmtpPoolMemberSummary> {
  return apiFetch(`/smtp-pools/${poolId}/accounts/${mailboxId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function removeSmtpPoolMember(poolId: string, mailboxId: string): Promise<void> {
  await apiFetch(`/smtp-pools/${poolId}/accounts/${mailboxId}`, { method: 'DELETE' });
}

export async function fetchSmtpPoolHealth(poolId: string): Promise<SmtpPoolHealth> {
  return apiFetch(`/smtp-pools/${poolId}/health`);
}

export async function fetchRotationSettings(): Promise<RotationSettings> {
  return apiFetch('/smtp-rotation/settings');
}

export async function updateRotationSettings(
  data: UpdateRotationSettingsInput,
): Promise<RotationSettings> {
  return apiFetch('/smtp-rotation/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchRotationStats(): Promise<RotationStats> {
  return apiFetch('/smtp-rotation/stats');
}

// ─── Warmup (Module 11) ─────────────────────────────────────────────────────

export type WarmupStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'DISABLED';

export interface WarmupConfigSummary {
  id: string;
  enabled: boolean;
  status: WarmupStatus;
  startingDailyLimit: number;
  maximumDailyLimit: number;
  rampStep: number;
  rampIntervalHours: number;
  currentDailyLimit: number;
  timezone: string;
  weekdays: number[];
  windowStart: string;
  windowEnd: string;
  consecutiveFailureThreshold: number;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  blockReason: string | null;
  startDate: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  blockedAt: string | null;
  lastProgressionAt: string | null;
}

export interface WarmupRecipient {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  enabled: boolean;
  consentConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WarmupAccountSummary {
  mailbox: {
    id: string;
    emailAddress: string;
    fromName: string;
    status: string;
    healthStatus: string;
    warmupStatus: WarmupStatus;
    dailySendingLimit: number;
    timezone: string | null;
  };
  config: WarmupConfigSummary | null;
  usage: {
    warmupSentToday: number;
    warmupReservedToday: number;
    campaignSentToday: number;
    campaignReservedToday: number;
    usageDate: string;
  };
}

export type WarmupIneligibilityReason =
  | 'ELIGIBLE'
  | 'WARMUP_DISABLED'
  | 'WARMUP_PAUSED'
  | 'WARMUP_BLOCKED'
  | 'WARMUP_COMPLETED'
  | 'WARMUP_NOT_STARTED'
  | 'WARMUP_DAILY_LIMIT_REACHED'
  | 'ACCOUNT_DAILY_LIMIT_REACHED'
  | 'OUTSIDE_SENDING_WINDOW'
  | 'MAILBOX_UNHEALTHY'
  | 'MAILBOX_DISABLED'
  | 'MAILBOX_UNVERIFIED'
  | 'MAILBOX_NOT_FOUND'
  | 'MISSING_CREDENTIALS'
  | 'NO_WARMUP_RECIPIENTS'
  | 'NO_ELIGIBLE_RECIPIENT';

export interface WarmupAccountDetail {
  mailbox: WarmupAccountSummary['mailbox'];
  config: WarmupConfigSummary | null;
  eligibility: {
    eligible: boolean;
    reason: WarmupIneligibilityReason;
    message: string;
    remainingCapacity: number;
    warmupRemaining: number;
    accountRemaining: number;
    configuredLimit: number;
  };
  capacity: {
    campaignRemaining: number;
    warmupRemaining: number;
    accountRemaining: number;
    dailySendingLimit: number;
    warmupDailyLimit: number | null;
    campaignSentToday: number;
    campaignReservedToday: number;
    warmupSentToday: number;
    warmupReservedToday: number;
    usageDate: string;
    timezone: string;
  } | null;
  recentFailures: Array<{
    id: string;
    recipientEmail: string;
    errorCategory: string | null;
    lastError: string | null;
    failedAt: string | null;
  }>;
}

export interface WarmupStats {
  totalConfigs: number;
  statusCounts: Record<string, number>;
  eligibleRecipients: number;
}

export interface WarmupHistoryEntry {
  id: string;
  workspaceId: string;
  mailboxId: string;
  usageDate: string;
  configuredLimit: number;
  scheduledCount: number;
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  deferredCount: number;
  statusSnapshot: WarmupStatus;
  healthSnapshot: string;
  createdAt: string;
  updatedAt: string;
}

export interface WarmupHistoryResponse {
  data: WarmupHistoryEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface WarmupSettingsInput {
  startingDailyLimit?: number;
  maximumDailyLimit?: number;
  rampStep?: number;
  rampIntervalHours?: number;
  timezone?: string;
  weekdays?: number[];
  windowStart?: string;
  windowEnd?: string;
  consecutiveFailureThreshold?: number;
}

export async function fetchWarmupStats(): Promise<WarmupStats> {
  return apiFetch('/warmup/stats');
}

export async function fetchWarmupRecipients(): Promise<WarmupRecipient[]> {
  return apiFetch('/warmup/recipients');
}

export async function createWarmupRecipient(input: {
  email: string;
  name?: string | null;
  consentConfirmed: true;
}): Promise<WarmupRecipient> {
  return apiFetch('/warmup/recipients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWarmupRecipient(
  id: string,
  input: { enabled?: boolean; name?: string | null; consentConfirmed?: boolean },
): Promise<WarmupRecipient> {
  return apiFetch(`/warmup/recipients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWarmupRecipient(id: string): Promise<void> {
  await apiFetch(`/warmup/recipients/${id}`, { method: 'DELETE' });
}

export async function fetchWarmupAccounts(): Promise<WarmupAccountSummary[]> {
  return apiFetch('/warmup/accounts');
}

export async function fetchWarmupAccount(mailboxId: string): Promise<WarmupAccountDetail> {
  return apiFetch(`/warmup/accounts/${mailboxId}`);
}

export async function enableWarmup(
  mailboxId: string,
  settings?: WarmupSettingsInput,
): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/enable`, {
    method: 'POST',
    body: JSON.stringify(settings ?? {}),
  });
}

export async function pauseWarmup(mailboxId: string): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/pause`, { method: 'POST' });
}

export async function resumeWarmup(mailboxId: string): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/resume`, { method: 'POST' });
}

export async function disableWarmup(mailboxId: string): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/disable`, { method: 'POST' });
}

export async function resetWarmup(mailboxId: string): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/reset`, {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
}

export async function updateWarmupSettings(
  mailboxId: string,
  settings: WarmupSettingsInput,
): Promise<WarmupConfigSummary> {
  return apiFetch(`/warmup/accounts/${mailboxId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export async function fetchWarmupHistory(
  mailboxId: string,
  params: { page?: number; limit?: number } = {},
): Promise<WarmupHistoryResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiFetch(`/warmup/accounts/${mailboxId}/history${qs ? `?${qs}` : ''}`);
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export type ReplyClassification =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'QUESTION'
  | 'NEEDS_FOLLOW_UP'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE'
  | 'WRONG_PERSON'
  | 'REFERRAL'
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'NEUTRAL'
  | 'UNKNOWN';

export type ConversationStatus =
  | 'OPEN'
  | 'NEEDS_RESPONSE'
  | 'WAITING'
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'UNSUBSCRIBED'
  | 'CLOSED'
  | 'ARCHIVED';

export type ConversationMatchStatus = 'MATCHED' | 'UNMATCHED' | 'PARTIAL';

export interface ReplyHandlingPolicy {
  pauseOnReply: boolean;
  stopOnReply: boolean;
  autoArchiveOoo: boolean;
  detectUnsubscribe: boolean;
}

export interface InboxStats {
  totalConversations: number;
  openConversations: number;
  needsResponse: number;
  unreadCount: number;
  byClassification: Partial<Record<ReplyClassification, number>>;
  byStatus: Partial<Record<ConversationStatus, number>>;
}

export interface InboxSyncHealthMailbox {
  id: string;
  emailAddress: string;
  inboundStatus: string;
  lastInboundSyncAt: string | null;
  lastInboundError: string | null;
  syncState: {
    status: string;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    lastMessageUid: number | null;
    lastError: string | null;
  } | null;
}

export interface InboxConversationSummary {
  id: string;
  subject: string | null;
  status: ConversationStatus;
  matchStatus: ConversationMatchStatus;
  classification: ReplyClassification | null;
  classificationConfidence: number | null;
  unreadCount: number;
  lastMessageAt: string | null;
  assignedUserId: string | null;
  lead: {
    id: string;
    email: string;
    name: string | null;
    company: string | null;
  } | null;
  campaign: { id: string; name: string } | null;
  mailbox: { id: string; emailAddress: string; fromName: string };
}

export interface InboxConversationMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBodySanitized: string | null;
  attachmentsMetadata: unknown;
  receivedAt: string | null;
  sentAt: string | null;
  status: string;
  classification: ReplyClassification | null;
  createdAt: string;
}

export interface InboxConversationNote {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface InboxConversationActivity {
  id: string;
  conversationId: string;
  type: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface InboxConversationDetail {
  conversation: InboxConversationSummary & {
    classificationSource: string | null;
    classificationSummary: string | null;
    suggestedAction: string | null;
    campaignLead: { id: string; status: string; repliedAt: string | null } | null;
    replyHandlingPolicy: ReplyHandlingPolicy | null;
  };
  messages: InboxConversationMessage[];
  notes: InboxConversationNote[];
  activities: InboxConversationActivity[];
}

export interface InboxConversationListQuery {
  search?: string;
  status?: ConversationStatus;
  classification?: ReplyClassification;
  matchStatus?: ConversationMatchStatus;
  mailboxId?: string;
  campaignId?: string;
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface MailboxInboundConfig {
  id: string;
  workspaceId: string;
  mailboxId: string;
  imapHost: string | null;
  imapPort: number | null;
  imapUsername: string | null;
  encryptionType: MailboxEncryption;
  syncIntervalMinutes: number;
  syncFolders: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxInboundConfigResponse {
  config: MailboxInboundConfig | null;
  inboundEnabled: boolean;
  inboundStatus: string;
  lastInboundSyncAt: string | null;
  lastInboundError: string | null;
}

export interface MailboxInboundConfigInput {
  enabled?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUsername?: string | null;
  encryptionType?: MailboxEncryption;
  syncIntervalMinutes?: number;
  syncFolders?: string[];
}

export interface ImapTestResult {
  success: boolean;
  message: string;
  errorCategory?: string;
}

export interface MailboxSyncResult {
  fetched: number;
  processed: number;
  duplicates: number;
  errors: number;
}

export interface InboxComposeDraftResult {
  subject: string;
  body: string;
  tone: string;
}

export async function fetchInboxStats(mailboxId?: string): Promise<{
  stats: InboxStats;
  syncHealth: InboxSyncHealthMailbox[];
}> {
  const qs = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : '';
  return apiFetch(`/inbox/stats${qs}`);
}

export async function fetchInboxConversations(
  query: InboxConversationListQuery = {},
): Promise<{
  data: InboxConversationSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.classification) params.set('classification', query.classification);
  if (query.matchStatus) params.set('matchStatus', query.matchStatus);
  if (query.mailboxId) params.set('mailboxId', query.mailboxId);
  if (query.campaignId) params.set('campaignId', query.campaignId);
  if (query.unreadOnly) params.set('unreadOnly', 'true');
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return apiFetch(`/inbox/conversations${qs ? `?${qs}` : ''}`);
}

export async function fetchInboxConversation(id: string): Promise<InboxConversationDetail> {
  return apiFetch(`/inbox/conversations/${id}`);
}

export async function markConversationRead(id: string): Promise<{ ok: true }> {
  return apiFetch(`/inbox/conversations/${id}/read`, { method: 'POST' });
}

export async function sendInboxReply(
  id: string,
  data: { subject: string; body: string; htmlBody?: string },
): Promise<{ conversationMessageId: string; queueJobId?: string }> {
  return apiFetch(`/inbox/conversations/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateConversation(
  id: string,
  data: {
    status?: ConversationStatus;
    classification?: ReplyClassification;
    assignedUserId?: string | null;
  },
): Promise<InboxConversationSummary> {
  return apiFetch(`/inbox/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function archiveConversation(id: string): Promise<{ ok: true; status: string }> {
  return apiFetch(`/inbox/conversations/${id}/archive`, { method: 'POST' });
}

export async function addConversationNote(
  id: string,
  content: string,
): Promise<InboxConversationNote> {
  return apiFetch(`/inbox/conversations/${id}/note`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function manualMatchConversation(
  id: string,
  data: { leadId?: string | null; campaignId?: string | null },
): Promise<InboxConversationSummary> {
  return apiFetch(`/inbox/conversations/${id}/match`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function composeInboxDraft(id: string): Promise<InboxComposeDraftResult> {
  return apiFetch(`/inbox/conversations/${id}/compose-draft`, { method: 'POST' });
}

export async function fetchMailboxInboundConfig(
  mailboxId: string,
): Promise<MailboxInboundConfigResponse> {
  return apiFetch(`/mailboxes/${mailboxId}/inbound`);
}

export async function updateMailboxInboundConfig(
  mailboxId: string,
  data: MailboxInboundConfigInput,
): Promise<{ ok: true; config: MailboxInboundConfig | null }> {
  return apiFetch(`/mailboxes/${mailboxId}/inbound`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function testMailboxInbound(
  mailboxId: string,
  data?: {
    imapHost: string;
    imapPort: number;
    imapUsername?: string;
    password: string;
    encryptionType?: MailboxEncryption;
  },
): Promise<ImapTestResult> {
  return apiFetch(`/mailboxes/${mailboxId}/inbound/test`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  });
}

export async function syncMailbox(mailboxId: string): Promise<MailboxSyncResult> {
  return apiFetch(`/mailboxes/${mailboxId}/sync`, { method: 'POST' });
}

// ─── Deliverability (Module 13) ───────────────────────────────────────────────

export type DeliverabilityPeriod = 'today' | '7d' | '30d';
export type HealthTier = 'EXCELLENT' | 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'CRITICAL';
export type ProtectionLevel = 'NORMAL' | 'WARNING' | 'AT_RISK' | 'CRITICAL';
export type DnsCheckStatus = 'PASS' | 'FAIL' | 'INVALID' | 'UNKNOWN' | 'NOT_CHECKED';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface DeliveryCounters {
  attempted: number;
  sent: number;
  delivered: number;
  bounced: number;
  hardBounces: number;
  softBounces: number;
  failed: number;
  replies: number;
  uniqueRepliedLeads: number;
  unsubscribes: number;
  complaints: number;
  complaintDataAvailable: boolean;
}

export interface DeliveryRates {
  deliveryRate: number;
  bounceRate: number;
  hardBounceRate: number;
  failureRate: number;
  replyRate: number;
  unsubscribeRate: number;
  complaintRate: number | null;
}

export interface HealthScoreComponent {
  key: string;
  label: string;
  weight: number;
  normalized: number;
  points: number;
  detail: string;
}

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  direction: 'IMPROVED' | 'WORSENED' | 'UNCHANGED';
}

export interface DeliverabilityOverview {
  period: DeliverabilityPeriod;
  range: { from: string; to: string };
  healthScore: number;
  tier: HealthTier;
  scoreExplanation: string;
  disclaimer: string;
  components: HealthScoreComponent[];
  counters: DeliveryCounters;
  rates: DeliveryRates;
  trends: {
    bounceRate: MetricTrend;
    replyRate: MetricTrend;
    failureRate: MetricTrend;
    unsubscribeRate: MetricTrend;
    sent: MetricTrend;
  };
  mailboxSummary: {
    total: number;
    healthy: number;
    needsAttention: number;
    atRisk: number;
    critical: number;
    paused: number;
  };
  complaintDataAvailable: boolean;
  recommendations: string[];
}

export interface DeliverabilityTimelinePoint {
  date: string;
  sent: number;
  bounced: number;
  failed: number;
  replies: number;
  unsubscribes: number;
  bounceRate: number;
  failureRate: number;
  replyRate: number;
  unsubscribeRate: number;
  healthScore: number;
}

export interface MailboxHealthRow {
  mailboxId: string;
  emailAddress: string;
  status: string;
  healthStatus: string;
  healthScore: number;
  tier: HealthTier;
  protectionLevel: ProtectionLevel;
  protectionReason: string | null;
  warmupStatus: string;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface DomainAuthSummary {
  domain: string;
  spfStatus: DnsCheckStatus;
  dkimStatus: DnsCheckStatus;
  dmarcStatus: DnsCheckStatus;
  mxStatus: DnsCheckStatus;
  dmarcPolicy: string | null;
  dkimSelectors: unknown;
  checkedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  recommendations: string[];
}

export interface MailboxVelocity {
  today: number;
  dailyLimit: number;
  lastHour: number;
  last15Minutes: number;
  baselinePerDay: number;
  anomalyDetected: boolean;
  anomalyDescription: string | null;
}

export interface MailboxDeliverabilityDetail {
  mailbox: {
    id: string;
    emailAddress: string;
    status: string;
    healthStatus: string;
    warmupStatus: string;
    dailySendingLimit: number;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    protectionLevel: ProtectionLevel;
    protectionReason: string | null;
    protectionUpdatedAt: string | null;
  };
  healthScore: number;
  tier: HealthTier;
  scoreExplanation: string;
  disclaimer: string;
  components: HealthScoreComponent[];
  counters: DeliveryCounters;
  rates: DeliveryRates;
  velocity: MailboxVelocity;
  domain: DomainAuthSummary | null;
  complaintDataAvailable: boolean;
  recommendations: string[];
}

export interface CampaignHealthRow {
  campaignId: string;
  name: string;
  status: string;
  healthScore: number;
  tier: HealthTier;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface DeliverabilityAlert {
  id: string;
  severity: AlertSeverity;
  alertType: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  title: string;
  message: string;
  recommendation: string | null;
  status: AlertStatus;
  occurredAt: string;
  resolvedAt: string | null;
}

export interface DeliverabilityPolicyResponse {
  protection: {
    pauseOnCriticalBounceRate: boolean;
    pauseLeadOnHardBounce: boolean;
    stopOnUnsubscribed: boolean;
    reduceSendingOnCritical: boolean;
    blockRecipientsAtRisk: boolean;
  };
  thresholds: {
    excellent: number;
    healthy: number;
    needsAttention: number;
    atRisk: number;
    criticalBounceRatePercent: number;
    warningBounceRatePercent: number;
    criticalFailureRatePercent: number;
    warningFailureRatePercent: number;
    warningUnsubscribeRatePercent: number;
    softBounceThreshold: number;
    softBounceSuppressThreshold: number;
    minimumVolumeForRates: number;
    velocityAnomalyMultiplier: number;
    dnsCacheTtlHours: number;
    dnsRecheckCooldownMinutes: number;
  };
  disclaimer?: string;
}

export interface DeliverabilityAnalysis {
  summary: string;
  riskScore: number;
  investigationAreas: string[];
  recommendations: string[];
  advisoryOnly: true;
  disclaimer: string;
}

export async function fetchDeliverabilityOverview(
  period: DeliverabilityPeriod = '7d',
): Promise<DeliverabilityOverview> {
  return apiFetch(`/deliverability/overview?period=${period}`);
}

export async function fetchDeliverabilityTimeline(
  period: DeliverabilityPeriod = '7d',
): Promise<{ points: DeliverabilityTimelinePoint[] }> {
  return apiFetch(`/deliverability/timeline?period=${period}`);
}

export async function fetchDeliverabilityMailboxes(
  period: DeliverabilityPeriod = '7d',
): Promise<{ mailboxes: MailboxHealthRow[]; disclaimer: string }> {
  return apiFetch(`/deliverability/mailboxes?period=${period}`);
}

export async function fetchDeliverabilityMailbox(
  mailboxId: string,
  period: DeliverabilityPeriod = '7d',
): Promise<MailboxDeliverabilityDetail> {
  return apiFetch(`/deliverability/mailboxes/${mailboxId}?period=${period}`);
}

export async function fetchDeliverabilityMailboxTimeline(
  mailboxId: string,
  period: DeliverabilityPeriod = '7d',
): Promise<{ points: DeliverabilityTimelinePoint[] }> {
  return apiFetch(`/deliverability/mailboxes/${mailboxId}/timeline?period=${period}`);
}

export async function resumeMailboxSending(
  mailboxId: string,
  note?: string,
): Promise<{ resumed: boolean; note: string }> {
  return apiFetch(`/deliverability/mailboxes/${mailboxId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function fetchDeliverabilityCampaigns(
  period: DeliverabilityPeriod = '7d',
): Promise<{ campaigns: CampaignHealthRow[]; disclaimer: string }> {
  return apiFetch(`/deliverability/campaigns?period=${period}`);
}

export async function fetchDeliverabilityAlerts(params?: {
  status?: AlertStatus;
  severity?: AlertSeverity;
  page?: number;
  limit?: number;
}): Promise<{
  alerts: DeliverabilityAlert[];
  pagination: { page: number; limit: number; total: number };
}> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch(`/deliverability/alerts${suffix}`);
}

export async function updateDeliverabilityAlert(
  id: string,
  status: AlertStatus,
): Promise<{ status: AlertStatus }> {
  return apiFetch(`/deliverability/alerts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchDeliverabilityDomains(): Promise<{
  domains: DomainAuthSummary[];
  note: string;
}> {
  return apiFetch('/deliverability/domains');
}

export async function checkDomainHealth(
  domain: string,
  data?: { dkimSelector?: string; force?: boolean },
): Promise<DomainAuthSummary> {
  return apiFetch(`/deliverability/domains/${encodeURIComponent(domain)}/check`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  });
}

export async function fetchDeliverabilityPolicy(): Promise<DeliverabilityPolicyResponse> {
  return apiFetch('/deliverability/policy');
}

export async function updateDeliverabilityPolicy(
  data: {
    protection?: Partial<DeliverabilityPolicyResponse['protection']>;
    thresholds?: Partial<DeliverabilityPolicyResponse['thresholds']>;
  },
): Promise<DeliverabilityPolicyResponse> {
  return apiFetch('/deliverability/policy', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function analyzeDeliverability(
  mailboxId: string,
  period: DeliverabilityPeriod = '7d',
): Promise<DeliverabilityAnalysis> {
  return apiFetch('/deliverability/analyze', {
    method: 'POST',
    body: JSON.stringify({ mailboxId, period }),
  });
}

export async function downloadDeliverabilityExport(
  entity: 'mailboxes' | 'campaigns',
  period: DeliverabilityPeriod,
): Promise<{ filename: string; csv: string }> {
  const response = await fetch(
    `${API_URL}/deliverability/export?entity=${entity}&period=${period}`,
    { credentials: 'include' },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  return {
    filename: `deliverability-${entity}-${period}.csv`,
    csv: await response.text(),
  };
}

// ─── Analytics (Module 14) ────────────────────────────────────────────────────

export type AnalyticsPeriod = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  campaignId?: string;
  mailboxId?: string;
  source?: string;
  industry?: string;
  country?: string;
}

/// A rate the API withheld because the denominator was too small carries a null
/// value; the UI must render "Insufficient data" rather than 0%.
export interface RateValue {
  value: number | null;
  numerator: number;
  denominator: number;
  denominatorLabel: string;
  sufficientData: boolean;
}

export interface AnalyticsRangeMeta {
  from: string;
  to: string;
  period: AnalyticsPeriod;
  days: number;
}

export type FunnelStage =
  | 'IMPORTED'
  | 'VERIFIED'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'POSITIVE_REPLY'
  | 'MEETING';

export interface FunnelStep {
  stage: FunnelStage;
  label: string;
  count: number;
  conversionFromPrevious: RateValue | null;
  conversionFromTop: RateValue | null;
  dropOff: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  definitions: Record<FunnelStage, string>;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  trend: MetricTrend | null;
  note?: string;
}

export interface AnalyticsTimelinePoint {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  replies: number;
  unsubscribes: number;
  deliveryRate: number;
  bounceRate: number;
  replyRate: number;
}

export interface DimensionRow {
  key: string;
  label: string;
  leads: number;
  contacted: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  replyRate: RateValue;
  positiveReplyRate: RateValue;
}

export interface CampaignAnalyticsRow {
  campaignId: string;
  name: string;
  status: string;
  enrolledLeads: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
  positiveReplies: number;
  meetings: number;
  positiveReplyRate: RateValue;
}

export interface SequenceStepRow {
  stepId: string;
  campaignId: string;
  campaignName: string;
  order: number;
  subject: string;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface SubjectRow {
  subject: string;
  sent: number;
  replies: number;
  replyRate: RateValue;
}

export interface MailboxAnalyticsRow {
  mailboxId: string;
  emailAddress: string;
  poolNames: string[];
  healthScore: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface SmtpPoolRow {
  poolId: string;
  name: string;
  mailboxCount: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface ReplyAnalytics {
  totalReplies: number;
  uniqueRepliedLeads: number;
  breakdown: Array<{ classification: string; count: number }>;
  positive: number;
  negative: number;
  outOfOffice: number;
  unsubscribes: number;
  positiveRateOfReplies: RateValue;
  positiveRateOfContacted: RateValue;
  responseTime: { averageHours: number | null; medianHours: number | null; sampleSize: number };
}

export interface MeetingAnalytics {
  booked: number;
  bySource: Array<{ source: string; count: number }>;
  meetingRateOfPositiveReplies: RateValue;
  meetingRateOfContacted: RateValue;
  manualEntryOnly: boolean;
}

export interface VerificationAnalytics {
  total: number;
  verified: number;
  invalid: number;
  risky: number;
  unknown: number;
  disposable: number;
  roleBased: number;
  verificationRate: RateValue;
}

export interface AnalyticsInsight {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  detail: string;
  recommendation: string | null;
}

export interface AnalyticsOverview {
  range: AnalyticsRangeMeta;
  previousRange: { from: string; to: string };
  kpis: KpiCard[];
  counters: DeliveryCounters;
  rates: DeliveryRates;
  funnel: FunnelResult;
  timeline: AnalyticsTimelinePoint[];
  replies: ReplyAnalytics;
  meetings: MeetingAnalytics;
  topCampaigns: CampaignAnalyticsRow[];
  topMailboxes: MailboxAnalyticsRow[];
  insights: AnalyticsInsight[];
  limitations: string[];
}

export interface WarmupAnalytics {
  range: AnalyticsRangeMeta;
  scheduled: number;
  attempted: number;
  sent: number;
  failed: number;
  deferred: number;
  mailboxesWarming: number;
  daily: Array<{ date: string; sent: number; failed: number }>;
  note: string;
}

export interface WebsiteIntelligenceAnalytics {
  range: AnalyticsRangeMeta;
  analyzed: number;
  byPriority: Array<{ priority: string; count: number }>;
  byScoreBucket: Array<{ bucket: string; count: number }>;
  averageWebsiteScore: number | null;
  averageOpportunityScore: number | null;
}

export interface ImportAnalytics {
  range: AnalyticsRangeMeta;
  totalImports: number;
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  bySource: Array<{ source: string; imports: number; imported: number }>;
  coverageNote: string;
}

export interface DiscoveryAnalytics {
  range: AnalyticsRangeMeta;
  totalJobs: number;
  completed: number;
  failed: number;
  cancelled: number;
  partial: number;
  running: number;
  businessesDiscovered: number;
  uniqueLeads: number;
  duplicatesRemoved: number;
  leadsPromoted: number;
  leadsQualified: number;
  enriched: number;
  emailsFound: number;
  emailsVerified: number;
  bySource: Array<{
    source: string;
    jobs: number;
    discovered: number;
    promoted: number;
    qualified: number;
  }>;
}

export interface DailyActivity {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  replies: number;
  newLeads: number;
  meetings: number;
  scheduledSends: number;
}

export type LeadOutcomeType = 'MEETING_BOOKED' | 'QUALIFIED' | 'CONVERTED';

export interface LeadOutcome {
  id: string;
  workspaceId: string;
  type: LeadOutcomeType;
  source: string;
  occurredAt: string;
  note: string | null;
  lead: { id: string; email: string; fullName: string | null; company: string | null } | null;
  campaign: { id: string; name: string } | null;
}

export interface AnalyticsAnalysis {
  summary: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
  advisoryOnly: boolean;
  limitations: string[];
  disclaimer: string;
}

function analyticsQueryString(query: AnalyticsQuery): string {
  const params = new URLSearchParams({ period: query.period });
  for (const key of ['startDate', 'endDate', 'campaignId', 'mailboxId', 'source', 'industry', 'country'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function fetchAnalyticsOverview(query: AnalyticsQuery): Promise<AnalyticsOverview> {
  return apiFetch(`/analytics/overview?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsTimeline(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; points: AnalyticsTimelinePoint[]; note: string }> {
  return apiFetch(`/analytics/timeline?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsFunnel(
  query: AnalyticsQuery,
): Promise<FunnelResult & { range: AnalyticsRangeMeta }> {
  return apiFetch(`/analytics/funnel?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsCampaigns(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; campaigns: CampaignAnalyticsRow[] }> {
  return apiFetch(`/analytics/campaigns?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsCampaignDetail(
  campaignId: string,
  query: AnalyticsQuery,
): Promise<{
  range: AnalyticsRangeMeta;
  campaign: { id: string; name: string; status: string; launchedAt: string | null };
  summary: CampaignAnalyticsRow | null;
  timeline: AnalyticsTimelinePoint[];
  steps: SequenceStepRow[];
  replies: ReplyAnalytics;
  funnel: FunnelResult;
}> {
  return apiFetch(`/analytics/campaigns/${campaignId}?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsSequences(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; steps: SequenceStepRow[]; attributionNote: string }> {
  return apiFetch(`/analytics/sequences?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsSubjects(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; subjects: SubjectRow[]; note: string }> {
  return apiFetch(`/analytics/subjects?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsMailboxes(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; mailboxes: MailboxAnalyticsRow[] }> {
  return apiFetch(`/analytics/mailboxes?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsSmtpPools(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; pools: SmtpPoolRow[] }> {
  return apiFetch(`/analytics/smtp-pools?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsLeads(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; verification: VerificationAnalytics; funnel: FunnelResult }> {
  return apiFetch(`/analytics/leads?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsDimension(
  dimension: 'sources' | 'industries' | 'geography' | 'job-titles' | 'company-sizes',
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; rows: DimensionRow[]; note?: string }> {
  return apiFetch(`/analytics/${dimension}?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsReplies(
  query: AnalyticsQuery,
): Promise<{ range: AnalyticsRangeMeta; replies: ReplyAnalytics; meetings: MeetingAnalytics }> {
  return apiFetch(`/analytics/replies?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsWarmup(query: AnalyticsQuery): Promise<WarmupAnalytics> {
  return apiFetch(`/analytics/warmup?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsWebsiteIntelligence(
  query: AnalyticsQuery,
): Promise<WebsiteIntelligenceAnalytics> {
  return apiFetch(`/analytics/website-intelligence?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsImports(query: AnalyticsQuery): Promise<ImportAnalytics> {
  return apiFetch(`/analytics/imports?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsDiscovery(query: AnalyticsQuery): Promise<DiscoveryAnalytics> {
  return apiFetch(`/analytics/discovery?${analyticsQueryString(query)}`);
}

export async function fetchAnalyticsDailyActivity(): Promise<DailyActivity> {
  return apiFetch('/analytics/daily-activity');
}

export async function fetchAnalyticsOutcomes(params: {
  type?: LeadOutcomeType;
  page?: number;
  limit?: number;
}): Promise<{ items: LeadOutcome[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  return apiFetch(`/analytics/outcomes?${query.toString()}`);
}

export async function recordLeadOutcome(data: {
  leadId: string;
  type: LeadOutcomeType;
  campaignId?: string;
  occurredAt?: string;
  note?: string;
}): Promise<LeadOutcome> {
  return apiFetch('/analytics/outcomes', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteLeadOutcome(id: string): Promise<void> {
  return apiFetch(`/analytics/outcomes/${id}`, { method: 'DELETE' });
}

export async function analyzeAnalytics(query: AnalyticsQuery): Promise<AnalyticsAnalysis> {
  return apiFetch('/analytics/analyze', {
    method: 'POST',
    body: JSON.stringify({
      period: query.period,
      startDate: query.startDate,
      endDate: query.endDate,
      campaignId: query.campaignId,
    }),
  });
}

export async function downloadAnalyticsExport(
  entity:
    | 'campaigns'
    | 'mailboxes'
    | 'sequences'
    | 'funnel'
    | 'timeline'
    | 'sources'
    | 'industries'
    | 'geography'
    | 'job-titles',
  query: AnalyticsQuery,
): Promise<{ filename: string; csv: string }> {
  const response = await fetch(
    `${API_URL}/analytics/export?entity=${entity}&${analyticsQueryString(query)}`,
    { credentials: 'include' },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  return { filename: `analytics-${entity}-${query.period}.csv`, csv: await response.text() };
}

// ─── Automations (Module 15) ──────────────────────────────────────────────────

export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedVersion?: { id: string; version: number; publishedAt: string | null } | null;
  _count?: { executions: number };
}

export interface WorkflowGraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  versions: Array<{
    id: string;
    version: number;
    nodes: WorkflowGraphNode[];
    edges: WorkflowGraphEdge[];
    publishedAt: string | null;
  }>;
  publishedVersion?: {
    id: string;
    version: number;
    nodes: WorkflowGraphNode[];
    edges: WorkflowGraphEdge[];
    publishedAt: string | null;
  } | null;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WorkflowExecution {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  currentNodeId: string | null;
  lead?: { id: string; email: string; firstName: string | null; lastName: string | null };
  nodeExecutions?: Array<{
    id: string;
    nodeId: string;
    nodeType: string;
    status: string;
    error: string | null;
    result: Record<string, unknown>;
    createdAt: string;
  }>;
}

export async function fetchWorkflows(status?: WorkflowStatus): Promise<WorkflowSummary[]> {
  const qs = status ? `?status=${status}` : '';
  return apiFetch(`/automations${qs}`);
}

export async function fetchWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}`);
}

export async function createWorkflow(data: { name: string; description?: string }): Promise<WorkflowDetail> {
  return apiFetch('/automations', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateWorkflow(
  id: string,
  data: { name?: string; description?: string; nodes?: WorkflowGraphNode[]; edges?: WorkflowGraphEdge[] },
): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function publishWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}/publish`, { method: 'POST', body: '{}' });
}

export async function pauseWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}/pause`, { method: 'POST', body: '{}' });
}

export async function resumeWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}/resume`, { method: 'POST', body: '{}' });
}

export async function archiveWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}/archive`, { method: 'POST', body: '{}' });
}

export async function duplicateWorkflow(id: string): Promise<WorkflowDetail> {
  return apiFetch(`/automations/${id}/duplicate`, { method: 'POST', body: '{}' });
}

export async function fetchWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return apiFetch('/automations/templates');
}

export async function createWorkflowFromTemplate(templateId: string): Promise<WorkflowDetail> {
  return apiFetch('/automations/from-template', {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });
}

export async function fetchWorkflowExecutions(id: string): Promise<WorkflowExecution[]> {
  return apiFetch(`/automations/${id}/executions`);
}

export async function fetchWorkflowExecution(executionId: string): Promise<WorkflowExecution> {
  return apiFetch(`/automations/executions/${executionId}`);
}

export async function fetchWorkflowLogs(id: string): Promise<unknown[]> {
  return apiFetch(`/automations/${id}/logs`);
}

export async function fetchNotifications(params?: {
  unreadOnly?: boolean;
}): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const qs = params?.unreadOnly ? '?unreadOnly=true' : '';
  return apiFetch(`/automations/notifications${qs}`);
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  return apiFetch(`/automations/notifications/${id}/read`, { method: 'POST', body: '{}' });
}

// ─── Lead Discovery (Module 16) ──────────────────────────────────────────────

export interface DiscoverySource {
  source: string;
  displayName: string;
  implemented: boolean;
  configured: boolean;
  enabled: boolean;
  billable: boolean;
  fileBased: boolean;
  note?: string;
  usage: {
    requestCount: number;
    successfulRequests: number;
    failedRequests: number;
    resultCount: number;
    periodStart: string;
    lastUsedAt: string | null;
  } | null;
}

export interface DiscoveryJob {
  id: string;
  workspaceId: string;
  source: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  name: string | null;
  query: Record<string, unknown>;
  requestedCount: number;
  discoveredCount: number;
  uniqueCount: number;
  duplicateCount: number;
  enrichedCount: number;
  websiteAnalyzedCount: number;
  emailsFoundCount: number;
  emailsVerifiedCount: number;
  qualifiedCount: number;
  promotedCount: number;
  failedCount: number;
  error: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DiscoveredLead {
  id: string;
  jobId: string;
  stage: string;
  isDuplicate: boolean;
  matchReason: string | null;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  jobTitle: string | null;
  email: string | null;
  emailSource: string | null;
  emailStatus: string | null;
  phone: string | null;
  website: string | null;
  normalizedDomain: string | null;
  industry: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  employeeCount: string | null;
  source: string;
  sourceUrl: string | null;
  icpFitScore: number | null;
  websiteScore: number | null;
  aiOpportunity: string | null;
  qualified: boolean;
  qualifyReason: string | null;
  qualificationVersion: string | null;
  qualificationSignals: Array<{
    code: string;
    dimension: string;
    status: string;
    score: number;
    detail?: string;
  }> | null;
  promotedLeadId: string | null;
  createdAt: string;
}

export interface DiscoverySearchInput {
  country?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  postalCode?: string;
  industry?: string;
  category?: string;
  keywords?: string[];
  radiusMeters?: number;
  maxResults: number;
  requireWebsite: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  minScore: number;
}

export async function fetchDiscoverySources(): Promise<{ data: DiscoverySource[] }> {
  return apiFetch('/lead-discovery/sources');
}

export async function updateDiscoverySource(data: { source: string; enabled: boolean }) {
  return apiFetch('/lead-discovery/sources', { method: 'PUT', body: JSON.stringify(data) });
}

export async function createDiscoveryJob(data: {
  source: string;
  name?: string;
  query: DiscoverySearchInput;
  file?: { data: string; mimeType: string; columnMappings?: Record<string, string> };
}): Promise<{ jobId: string; status: string }> {
  return apiFetch('/lead-discovery/jobs', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchDiscoveryJobs(params?: Record<string, string>): Promise<{
  data: DiscoveryJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/lead-discovery/jobs${query}`);
}

export async function fetchDiscoveryJob(id: string): Promise<DiscoveryJob> {
  return apiFetch(`/lead-discovery/jobs/${id}`);
}

export async function cancelDiscoveryJob(id: string): Promise<DiscoveryJob> {
  return apiFetch(`/lead-discovery/jobs/${id}/cancel`, { method: 'POST' });
}

export async function retryDiscoveryJob(id: string): Promise<{ jobId: string; status: string }> {
  return apiFetch(`/lead-discovery/jobs/${id}/retry`, { method: 'POST' });
}

export async function fetchDiscoveryResults(
  id: string,
  params?: Record<string, string>,
): Promise<{
  data: DiscoveredLead[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return apiFetch(`/lead-discovery/jobs/${id}/results${query}`);
}

export async function saveDiscoveredLeads(
  id: string,
  discoveredLeadIds: string[],
): Promise<{
  promoted: number;
  created: number;
  updated: number;
  skipped: Array<{ discoveredLeadId: string; reason: string }>;
  leadIds: string[];
}> {
  return apiFetch(`/lead-discovery/jobs/${id}/save`, {
    method: 'POST',
    body: JSON.stringify({ discoveredLeadIds }),
  });
}

export async function enrollDiscoveredLeads(
  id: string,
  data: { discoveredLeadIds: string[]; campaignId: string; force?: boolean },
): Promise<{
  promotion: { promoted: number; skipped: Array<{ discoveredLeadId: string; reason: string }> };
  enrollment: { enrolled: number; skipped: number; queued?: boolean; jobId?: string; leadCount?: number };
}> {
  return apiFetch(`/lead-discovery/jobs/${id}/enroll`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function previewDiscoveryImport(data: {
  data: string;
  mimeType: string;
  filename?: string;
}): Promise<{
  headers: string[];
  rows: Record<string, string>[];
  totalRowCount: number;
  detectedMappings: Array<{ csvColumn: string; leadField: string; confidence: number }>;
  mappings: Record<string, string>;
}> {
  return apiFetch('/lead-discovery/import/preview', { method: 'POST', body: JSON.stringify(data) });
}

export function discoveryExportUrl(id: string, format: 'csv' | 'xlsx', qualifiedOnly?: boolean): string {
  const params = new URLSearchParams({ format });
  if (qualifiedOnly) params.set('qualified', 'true');
  return `${API_URL}/lead-discovery/jobs/${id}/export?${params}`;
}

export async function fetchDiscoveryActivity(
  jobId: string,
): Promise<{
  data: Array<{
    id: string;
    type: string;
    summary: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}> {
  return apiFetch(`/lead-discovery/jobs/${jobId}/activity`);
}

export async function requalifyDiscoveryJob(
  jobId: string,
): Promise<{
  requalified: number;
  newlyQualified: number;
  newlyDisqualified: number;
  unchanged: number;
}> {
  return apiFetch(`/lead-discovery/jobs/${jobId}/requalify`, { method: 'POST' });
}

// ─── Lead Research (Module 17) ───────────────────────────────────────────────

export type ResearchSource = 'LINKEDIN' | 'WEBSITE' | 'FACEBOOK' | 'YOUTUBE' | 'REDDIT' | 'WEB' | 'OTHER';
export type ResearchType = 'COMPANY' | 'PERSON' | 'JOB' | 'OTHER';
export type ResearchStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'MANUAL_REVIEW'
  | 'FAILED'
  | 'UNAVAILABLE';
/** Lifecycle status plus the UI-only "nothing researched yet" state. */
export type ResearchDisplayStatus = ResearchStatus | 'NOT_RESEARCHED';
export type ResearchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/** Field-level provenance. `confidence` is 0..1; `verification` is never upgraded client-side. */
export interface ResearchProvenance {
  field: string;
  value: string | number | boolean | null;
  source: string;
  sourceUrl: string | null;
  provider: string | null;
  retrievedAt: string | null;
  confidence: number;
  verification: VerificationState;
}

export interface ResearchCompanyData {
  name?: string | null;
  url?: string | null;
  industry?: string | null;
  location?: string | null;
  employeeRange?: string | null;
}

export interface ResearchPersonData {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  title?: string | null;
  profileUrl?: string | null;
}

export interface ResearchSignalsData {
  decisionMaker?: boolean | null;
  hiring?: boolean | null;
  growthSignal?: boolean | null;
  technologySignal?: boolean | null;
}

export interface ResearchStructuredData {
  company?: ResearchCompanyData | null;
  person?: ResearchPersonData | null;
  signals?: ResearchSignalsData | null;
  source?: { platform?: string | null; url?: string | null; retrievedAt?: string | null } | null;
}

export interface LeadResearch {
  id: string;
  workspaceId: string;
  leadId: string;
  source: ResearchSource;
  researchType: ResearchType;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  status: ResearchStatus;
  provider: string | null;
  confidence: ResearchConfidence | null;
  summary: string | null;
  structuredData: ResearchStructuredData | null;
  provenance: ResearchProvenance[] | null;
  /** Sanitized provider output; omitted from queue rows. */
  rawData?: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  inputHash?: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchQueueLead {
  id: string;
  email: string;
  fullName: string | null;
  company: string | null;
  website: string | null;
  city: string | null;
  industry: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
}

export interface ResearchQueueItem extends Omit<LeadResearch, 'rawData'> {
  lead: ResearchQueueLead | null;
}

export interface ResearchQueueQuery {
  page?: number;
  limit?: number;
  status?: ResearchStatus | ResearchStatus[];
  source?: ResearchSource;
  researchType?: ResearchType;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ResearchQueueResponse {
  data: ResearchQueueItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  disabled?: boolean;
}

export interface ResearchProviderUsage {
  provider: string;
  source?: ResearchSource;
  enabled?: boolean;
  requestCount: number;
  successfulRequests: number;
  failedRequests: number;
  manualReviewCount?: number;
  lastUsedAt?: string | null;
}

export interface ResearchStats {
  total: number;
  byStatus: Partial<Record<ResearchStatus, number>>;
  byType: Partial<Record<ResearchType, number>>;
  manualReviewCount: number;
  pendingCount: number;
  verifiedCount: number;
  completedLast7Days: number;
  providers: ResearchProviderUsage[];
}

export type ResearchSuggestionKey = 'COMPANY_LINKEDIN' | 'PERSON_LINKEDIN' | 'WEBSITE' | 'WEB_SEARCH';

export interface ResearchSuggestion {
  key: ResearchSuggestionKey;
  label: string;
  reason: string;
  available: boolean;
  done: boolean;
}

export type ResearchHistorySource = 'LINKEDIN' | 'WEBSITE' | 'EMAIL_VERIFICATION';

export interface ResearchHistoryItem {
  id: string;
  date: string;
  source: ResearchHistorySource;
  type: string | null;
  status: string;
  provider: string | null;
  confidence: string | null;
  sourceUrl: string | null;
  href: string | null;
}

export type ProviderHealthStatus = 'READY' | 'NEEDS_SETUP' | 'UNAVAILABLE' | 'DISABLED';
export type ProviderAuthentication = 'CONFIGURED' | 'NOT_CONFIGURED' | 'NOT_REQUIRED';

export interface ProviderHealth {
  provider: string;
  displayName: string;
  status: ProviderHealthStatus;
  authentication: ProviderAuthentication;
  checkedAt: string | null;
  details: string[];
  implemented: boolean;
  note?: string | null;
  /** Workspace-level enablement. */
  enabled: boolean;
  usage?: ResearchProviderUsage | null;
}

export type ResearchProviderStatus =
  | { status: 'disabled' }
  | { status: 'unavailable'; degraded: true }
  | {
      status: 'ok';
      enabled: boolean;
      selectedProvider: string;
      chain: string[];
      providers: ProviderHealth[];
    };

export interface ResearchProviderConfig {
  id: string;
  workspaceId: string;
  source: ResearchSource;
  provider: string;
  enabled: boolean;
  requestCount: number;
  successfulRequests: number;
  failedRequests: number;
  manualReviewCount?: number;
  lastUsedAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ManualVerificationInput {
  person?: { firstName?: string; lastName?: string; title?: string; profileUrl?: string };
  company?: { name?: string; url?: string; industry?: string; location?: string; employeeRange?: string };
  signals?: { decisionMaker?: boolean; hiring?: boolean; growthSignal?: boolean; technologySignal?: boolean };
  notes?: string;
}

export async function fetchResearchProviderStatus(): Promise<ResearchProviderStatus> {
  return apiFetch('/lead-research/providers/status');
}

export async function runResearchHealthCheck(): Promise<ResearchProviderStatus> {
  return apiFetch('/lead-research/providers/health-check', { method: 'POST' });
}

export async function fetchResearchProviders(): Promise<{ providers: ResearchProviderConfig[] }> {
  return apiFetch('/lead-research/providers');
}

export async function updateResearchProvider(data: {
  source?: ResearchSource;
  provider: string;
  enabled: boolean;
}): Promise<{ providers: ResearchProviderConfig[] }> {
  return apiFetch('/lead-research/providers', { method: 'PUT', body: JSON.stringify(data) });
}

export async function startLinkedInResearch(data: {
  leadId: string;
  companyUrl?: string;
  personUrl?: string;
  forceRefresh?: boolean;
}): Promise<{ research: LeadResearch[]; queued: number; reused: number }> {
  return apiFetch('/lead-research/research', { method: 'POST', body: JSON.stringify(data) });
}

export async function approveResearch(data: {
  researchIds?: string[];
  leadIds?: string[];
}): Promise<{ queued: number; skipped: number; capped: boolean; limit: number }> {
  return apiFetch('/lead-research/research/batch', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchResearchQueue(query: ResearchQueueQuery = {}): Promise<ResearchQueueResponse> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return apiFetch(`/lead-research/queue${qs ? `?${qs}` : ''}`);
}

export async function fetchResearchStats(): Promise<ResearchStats> {
  return apiFetch('/lead-research/stats');
}

export async function fetchResearchSuggestions(leadId: string): Promise<{ suggestions: ResearchSuggestion[] }> {
  return apiFetch(`/lead-research/suggestions/${leadId}`);
}

export async function fetchLeadResearch(leadId: string): Promise<{ research: LeadResearch[] }> {
  return apiFetch(`/lead-research/lead/${leadId}`);
}

export async function fetchLeadResearchHistory(leadId: string): Promise<{ items: ResearchHistoryItem[] }> {
  return apiFetch(`/lead-research/lead/${leadId}/history`);
}

export async function fetchResearch(id: string): Promise<LeadResearch> {
  return apiFetch(`/lead-research/research/${id}`);
}

export async function submitManualVerification(id: string, data: ManualVerificationInput): Promise<LeadResearch> {
  return apiFetch(`/lead-research/research/${id}/verify`, { method: 'POST', body: JSON.stringify(data) });
}

export async function markResearchVerified(id: string): Promise<LeadResearch> {
  return apiFetch(`/lead-research/research/${id}/mark-verified`, { method: 'POST' });
}

export async function retryResearch(id: string): Promise<{ researchId: string; status: 'QUEUED' }> {
  return apiFetch(`/lead-research/research/${id}/retry`, { method: 'POST' });
}
