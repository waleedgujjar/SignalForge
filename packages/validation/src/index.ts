import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'error']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string(),
  timestamp: z.string().datetime(),
  version: z.string().optional(),
});

export const dependencyHealthSchema = z.object({
  status: healthStatusSchema,
  service: z.string(),
  timestamp: z.string().datetime(),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type DependencyHealthResponse = z.infer<typeof dependencyHealthSchema>;

// Auth
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');

export const signupSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: passwordSchema,
    confirmPassword: z.string(),
    name: z.string().min(1, 'Name is required'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const verifyEmailTokenSchema = z.object({
  token: z.string().min(1),
});

export const primaryUseCaseSchema = z.enum([
  'LEAD_GENERATION',
  'COLD_EMAIL',
  'SALES_OUTREACH',
  'AGENCY',
  'OTHER',
]);

export const onboardingSchema = z.object({
  workspaceName: z.string().min(1, 'Workspace name is required'),
  primaryUseCase: primaryUseCaseSchema.optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required'),
});

export const updateWorkspaceSettingsSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').optional(),
  timezone: z.string().min(1).optional(),
  defaultFromName: z.string().optional().nullable(),
  defaultReplyTo: z.string().email('Invalid email address').optional().nullable(),
  logoUrl: z.string().optional().nullable(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
});

export const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

const workspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
});

export const sessionResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    emailVerifiedAt: z.string().nullable().optional(),
  }),
  workspace: workspaceSummarySchema.nullable().optional(),
  workspaces: z.array(workspaceSummarySchema).default([]),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).nullable().optional(),
  needsOnboarding: z.boolean(),
});

// Mailbox
export const mailboxProviderSchema = z.enum(['SMTP', 'GOOGLE_OAUTH', 'MICROSOFT_OAUTH']);
export const mailboxEncryptionSchema = z.enum(['NONE', 'TLS', 'SSL']);
export const mailboxStatusSchema = z.enum([
  'UNVERIFIED',
  'ACTIVE',
  'DISABLED',
  'PAUSED',
  'ERROR',
  'DISCONNECTED',
]);
export const mailboxHealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']);
export const smtpErrorCategorySchema = z.enum([
  'AUTH_FAILED',
  'CONNECTION_REFUSED',
  'CONNECTION_TIMEOUT',
  'INVALID_HOST',
  'INVALID_PORT',
  'TLS_FAILED',
  'PROVIDER_REJECTED',
  'UNKNOWN',
]);

const hostnameSchema = z
  .string()
  .min(1, 'Host is required')
  .max(253)
  .regex(
    /^(?=.{1,253}$)(([a-zA-Z0-9](-*[a-zA-Z0-9])*)(\.[a-zA-Z0-9](-*[a-zA-Z0-9])*)*)$/,
    'Invalid hostname',
  );

const portSchema = z.number().int().min(1).max(65535);

export const createMailboxSchema = z.object({
  provider: mailboxProviderSchema.default('SMTP'),
  name: z.string().max(120).optional().nullable(),
  emailAddress: z.string().email(),
  fromName: z.string().min(1).max(120),
  replyTo: z.string().email().optional().nullable(),
  smtpHost: hostnameSchema.optional(),
  smtpPort: portSchema.optional(),
  smtpUsername: z.string().max(320).optional(),
  smtpPassword: z.string().max(1024).optional(),
  encryptionType: mailboxEncryptionSchema.default('TLS'),
  dailySendingLimit: z.number().int().min(1).max(10000).default(100),
  timezone: z.string().min(1).max(64).optional().nullable(),
  verified: z.boolean().optional(),
});

export const updateMailboxSchema = createMailboxSchema
  .partial()
  .omit({ smtpPassword: true, verified: true })
  .extend({
    smtpPassword: z.string().max(1024).optional(),
    status: mailboxStatusSchema.optional(),
  });

export const testConnectionSchema = z.object({
  smtpHost: hostnameSchema,
  smtpPort: portSchema,
  smtpUsername: z.string().min(1).max(320),
  smtpPassword: z.string().min(1).max(1024),
  encryptionType: mailboxEncryptionSchema.default('TLS'),
  emailAddress: z.string().email(),
  fromName: z.string().min(1).max(120),
});

export const mailboxListQuerySchema = z.object({
  status: mailboxStatusSchema.optional(),
  healthStatus: mailboxHealthStatusSchema.optional(),
  search: z.string().max(200).optional(),
  eligibleOnly: z.coerce.boolean().optional(),
});

export const bulkMailboxActionSchema = z.object({
  mailboxIds: z.array(z.string()).min(1).max(200),
  action: z.enum(['ENABLE', 'DISABLE']),
});

export const mailboxTestHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const mailboxResponseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string().nullable(),
  emailAddress: z.string(),
  fromName: z.string(),
  replyTo: z.string().nullable(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().nullable(),
  smtpUsername: z.string().nullable(),
  encryptionType: z.string(),
  status: z.string(),
  dailySendingLimit: z.number(),
  currentDailyUsage: z.number(),
  remainingToday: z.number(),
  timezone: z.string().nullable(),
  healthStatus: z.string(),
  healthScore: z.number().nullable(),
  warmupStatus: z.string(),
  verifiedAt: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastSuccessfulSendAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  assignedCampaigns: z
    .array(z.object({ id: z.string(), name: z.string(), status: z.string() }))
    .optional(),
  eligibility: z
    .object({
      eligible: z.boolean(),
      reason: z.string(),
      message: z.string(),
      remainingToday: z.number(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mailboxConnectionTestResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['SUCCESS', 'FAILED']),
  errorCategory: smtpErrorCategorySchema.nullable(),
  summary: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export const mailboxEligibilityResponseSchema = z.object({
  mailboxId: z.string(),
  eligible: z.boolean(),
  reason: z.string(),
  message: z.string(),
  remainingToday: z.number(),
});

// Campaign
export const delayUnitSchema = z.enum(['MINUTES', 'HOURS', 'DAYS']);
export const stepTypeSchema = z.enum(['EMAIL']);
export const duplicateEnrollmentPolicySchema = z.enum(['BLOCK', 'ALLOW', 'WARN']);

export const scheduleConfigSchema = z
  .object({
    timezone: z.string().min(1).optional(),
    days: z.array(z.number().int().min(0).max(6)).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    minDelayMinutes: z.number().int().min(0).max(1440).optional(),
    maxDelayMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .refine(
    (data) =>
      data.minDelayMinutes === undefined ||
      data.maxDelayMinutes === undefined ||
      data.maxDelayMinutes >= data.minDelayMinutes,
    { message: 'maxDelayMinutes must be >= minDelayMinutes', path: ['maxDelayMinutes'] },
  );

export const campaignStepSchema = z.object({
  order: z.number().int().nonnegative(),
  type: stepTypeSchema.default('EMAIL'),
  delayDays: z.number().int().nonnegative().default(0),
  delayAmount: z.number().int().nonnegative().default(0),
  delayUnit: delayUnitSchema.default('DAYS'),
  enabled: z.boolean().default(true),
  subjectTemplate: z.string().min(1),
  bodyTemplate: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const createCampaignStepSchema = campaignStepSchema.omit({ order: true }).extend({
  order: z.number().int().nonnegative().optional(),
});

export const updateCampaignStepSchema = createCampaignStepSchema.partial();

export const rotationStrategySchema = z.enum([
  'ROUND_ROBIN',
  'LEAST_UTILIZED',
  'HEALTH_AWARE',
  'CAMPAIGN_SPECIFIC',
  'CAPACITY_BASED',
]);

export const campaignSendingModeSchema = z.enum(['MAILBOX_LIST', 'SMTP_POOL', 'SINGLE_MAILBOX']);

export const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().max(2000).optional().nullable(),
  rotationStrategy: rotationStrategySchema.default('HEALTH_AWARE'),
  sendingMode: campaignSendingModeSchema.default('MAILBOX_LIST'),
  smtpPoolId: z.string().optional().nullable(),
  mailboxId: z.string().optional().nullable(),
  dailySendingLimit: z.number().int().positive().optional(),
  duplicateEnrollmentPolicy: duplicateEnrollmentPolicySchema.default('BLOCK'),
  mailboxIds: z.array(z.string()).default([]),
  leadIds: z.array(z.string()).default([]),
  steps: z.array(campaignStepSchema).default([]),
  scheduleConfig: scheduleConfigSchema.optional(),
  verificationPolicy: z.record(z.unknown()).optional(),
  suppressionPolicy: z.record(z.unknown()).optional(),
});

export const replyHandlingPolicySchema = z.object({
  pauseOnReply: z.boolean().default(false),
  stopOnReply: z.boolean().default(true),
  autoArchiveOoo: z.boolean().default(false),
  detectUnsubscribe: z.boolean().default(true),
});

export const followUpConfigSchema = z.object({
  followUpsEnabled: z.boolean().default(false),
  maxFollowUps: z.number().int().min(1).max(5).default(5),
});

export const disableFollowUpsSchema = z.object({
  confirmed: z.literal(true),
});

export const seedFollowUpsSchema = z.object({
  maxFollowUps: z.number().int().min(1).max(5).default(5),
});

export const campaignLeadStopReasonSchema = z.enum([
  'REPLIED',
  'POSITIVE_REPLY',
  'NEGATIVE_REPLY',
  'UNSUBSCRIBED',
  'BOUNCED',
  'HARD_BOUNCED',
  'MANUALLY_STOPPED',
  'CAMPAIGN_CANCELLED',
  'LEAD_PAUSED',
  'SUPPRESSED',
  'COMPLETED',
  'SYSTEM_ERROR',
]);

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  scheduledAt: z.string().datetime().optional().nullable(),
  replyHandlingPolicy: replyHandlingPolicySchema.optional(),
  followUpsEnabled: z.boolean().optional(),
  maxFollowUps: z.number().int().min(1).max(5).optional(),
  disableFollowUpsConfirmed: z.boolean().optional(),
});

export const campaignListQuerySchema = z.object({
  search: z.string().optional(),
  status: z
    .enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'ARCHIVED'])
    .optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const enrollCampaignLeadsSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
  force: z.boolean().default(false),
});

export const previewEligibilitySchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
});

export const reorderCampaignStepsSchema = z.object({
  orderedStepIds: z.array(z.string()).min(1),
});

export const launchCampaignSchema = z.object({}).default({});

export const stopCampaignSchema = z.object({
  confirmed: z.literal(true),
  reason: z.string().max(500).optional(),
});

export const campaignActivityQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const validateTemplateSchema = z.object({
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  leadId: z.string().optional(),
});

export const previewEmailSchema = z.object({
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  leadId: z.string(),
  seed: z.coerce.number().int().nonnegative().optional(),
  variationCount: z.coerce.number().int().positive().max(10).optional(),
});

// Lead
export const leadStatusEnum = z.enum([
  'NEW', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'UNQUALIFIED',
  'CONVERTED', 'UNSUBSCRIBED', 'BOUNCED', 'ARCHIVED',
]);

export const leadSourceEnum = z.enum([
  'MANUAL', 'CSV_IMPORT', 'GOOGLE_DRIVE', 'DISCOVERY', 'API', 'OTHER',
]);

// ─── LinkedIn URL (shared by Lead + Lead Research, Module 17) ────────────────

const isLinkedInHost = (host: string): boolean => host === 'linkedin.com' || host.endsWith('.linkedin.com');

/// Extracts the host of an http(s) URL without relying on the URL global (this
/// package compiles without DOM/node libs). Userinfo, non-numeric ports and
/// anything that is not a plain hostname fail to match and are rejected.
const URL_HOST_PATTERN =
  /^(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::\d{1,5})?(?:[/?#]|$)/i;

/// A linkedin.com URL. Only the host is checked here; path classification
/// (person / company / job) lives in @signalforge/lead-research so the two
/// stay in one place. Short links (lnkd.in) are rejected: they are never followed.
export const linkedinUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => {
      const match = URL_HOST_PATTERN.exec(value);
      const host = match?.[1]?.toLowerCase();
      return host !== undefined && isLinkedInHost(host);
    },
    { message: 'Must be a linkedin.com URL' },
  );

/// Permissive variant for lead forms: empty string / null mean "not provided".
export const optionalLinkedinUrlSchema = z.union([z.literal(''), z.null(), linkedinUrlSchema]).optional();

export const createLeadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  company: z.string().optional(),
  companyDomain: z.string().optional(),
  jobTitle: z.string().optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: optionalLinkedinUrlSchema,
  countryCode: z.string().length(2).optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  website: z.string().optional(),
  status: leadStatusEnum.optional(),
  source: leadSourceEnum.optional(),
  customFields: z.record(z.string()).optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const leadListQuerySchema = z.object({
  search: z.string().optional(),
  status: leadStatusEnum.optional(),
  source: leadSourceEnum.optional(),
  countryCode: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  verificationStatus: z
    .enum(['VERIFIED', 'RISKY', 'INVALID', 'UNKNOWN', 'DISPOSABLE', 'ROLE_BASED'])
    .optional(),
  campaignId: z.string().optional(),
  tagId: z.string().optional(),
  listId: z.string().optional(),
  enrichmentStatus: z.enum(['NOT_ENRICHED', 'QUEUED', 'ENRICHING', 'COMPLETED', 'PARTIAL', 'FAILED']).optional(),
  prospectPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).optional(),
  minProspectScore: z.coerce.number().int().min(0).max(100).optional(),
  sortBy: z.enum(['createdAt', 'email', 'firstName', 'fullName', 'company', 'phone', 'website', 'status', 'prospectScore']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const bulkLeadActionSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
});

export const bulkTagSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
  tagIds: z.array(z.string()).min(1),
});

export const bulkListSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
  listId: z.string(),
});

export const bulkStatusSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
  status: leadStatusEnum,
});

// Tags
export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const updateTagSchema = createTagSchema.partial();

// Lead Lists
export const createLeadListSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const updateLeadListSchema = createLeadListSchema.partial();

// Lead Notes
export const createLeadNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

// CSV Import
export const csvColumnMappingSchema = z.object({
  mappings: z.record(z.string()),
  skipDuplicates: z.boolean().default(true),
});

// Suppression
export const createSuppressionSchema = z.object({
  type: z.enum(['EMAIL', 'DOMAIN']),
  value: z.string().min(1),
  reason: z
    .enum(['MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'SPAM_COMPLAINT', 'INVALID', 'RISKY'])
    .default('MANUAL'),
});

export const bulkSuppressionSchema = z.object({
  entries: z.array(createSuppressionSchema).min(1),
});

// Verification
export const verifyEmailSchema = z.object({
  email: z.string().email(),
  leadId: z.string().optional(),
  forceRecheck: z.boolean().optional(),
});

export const bulkVerifySchema = z.object({
  emails: z.array(z.string().email()).optional(),
  leadIds: z.array(z.string().min(1)).optional(),
  name: z.string().optional(),
  source: z.enum(['LEADS', 'EXCEL', 'PASTE', 'DISCOVERY', 'SINGLE']).optional(),
}).refine((data) => (data.emails?.length ?? 0) > 0 || (data.leadIds?.length ?? 0) > 0, {
  message: 'Provide at least one email or leadId',
});

export const verificationJobListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const verificationHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(['VERIFIED', 'RISKY', 'INVALID', 'UNKNOWN', 'DISPOSABLE', 'ROLE_BASED']).optional(),
  jobId: z.string().optional(),
  search: z.string().optional(),
});

export const verificationExcelSchema = z.object({
  file: z.object({
    data: z.string().min(1),
    mimeType: z.string().min(1),
    filename: z.string().optional(),
  }),
  emailColumn: z.string().optional(),
  name: z.string().optional(),
});

export const updateVerificationPolicySchema = z.object({
  excludeInvalid: z.boolean().optional(),
  excludeDisposable: z.boolean().optional(),
  excludeHighRisk: z.boolean().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  blockUnverified: z.boolean().optional(),
  allowRoleEmails: z.boolean().optional(),
  blockRisky: z.boolean().optional(),
  blockUnknown: z.boolean().optional(),
});

// Custom fields
export const createCustomFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.string().default('TEXT'),
});

// Integrations
export const integrationProviderEnum = z.enum(['GOOGLE_DRIVE']);

export const connectIntegrationSchema = z.object({
  provider: integrationProviderEnum,
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// Drive Import
export const driveListFoldersSchema = z.object({
  integrationId: z.string().min(1),
  parentFolderId: z.string().optional(),
});

export const driveListFilesSchema = z.object({
  integrationId: z.string().min(1),
  folderId: z.string().min(1),
});

export const drivePreviewFileSchema = z.object({
  integrationId: z.string().min(1),
  fileId: z.string().min(1),
  maxRows: z.coerce.number().int().positive().max(100).default(25),
});

export const driveImportSchema = z.object({
  integrationId: z.string().min(1),
  files: z.array(z.object({
    fileId: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
  })).min(1).max(20),
  mappings: z.record(z.string()),
  options: z.object({
    skipDuplicates: z.boolean().default(true),
    tagIds: z.array(z.string()).optional(),
    listId: z.string().optional(),
  }),
});

export const importStatusEnum = z.enum([
  'PENDING', 'SCANNING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED',
]);

export const importHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  source: leadSourceEnum.optional(),
  status: importStatusEnum.optional(),
});

// Website Intelligence
export const analysisStatusEnum = z.enum([
  'PENDING', 'CRAWLING', 'ANALYZING', 'COMPLETED', 'FAILED',
]);

export const opportunityPriorityEnum = z.enum([
  'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH',
]);

export const analyzeWebsiteSchema = z.object({
  leadId: z.string().min(1),
  maxPages: z.coerce.number().int().positive().max(20).optional(),
  reanalyze: z.coerce.boolean().optional(),
  customPrompt: z.string().max(4000).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export const batchAnalyzeSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(100),
  maxPages: z.coerce.number().int().positive().max(20).optional(),
  confirmBulk: z.coerce.boolean().optional(),
});

export const analyzeWebsiteUrlSchema = z.object({
  url: z.string().min(1),
  leadId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  maxPages: z.coerce.number().int().positive().max(20).optional(),
  reanalyze: z.coerce.boolean().optional(),
});

export const websiteAnalysisQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  status: analysisStatusEnum.optional(),
  opportunityPriority: opportunityPriorityEnum.optional(),
  minWebsiteScore: z.coerce.number().int().min(0).max(100).optional(),
  maxWebsiteScore: z.coerce.number().int().min(0).max(100).optional(),
  sortBy: z.enum(['createdAt', 'websiteScore', 'opportunityScore']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Lead Enrichment
export const enrichmentStatusEnum = z.enum([
  'NOT_ENRICHED', 'QUEUED', 'ENRICHING', 'COMPLETED', 'PARTIAL', 'FAILED',
]);

export const prospectPriorityEnum = z.enum([
  'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH',
]);

export const seniorityEnum = z.enum([
  'EXECUTIVE', 'VP', 'DIRECTOR', 'MANAGER', 'INDIVIDUAL_CONTRIBUTOR', 'UNKNOWN',
]);

export const enrichLeadSchema = z.object({
  leadId: z.string().min(1),
});

export const batchEnrichSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
});

export const enrichmentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: enrichmentStatusEnum.optional(),
  prospectPriority: prospectPriorityEnum.optional(),
  minProspectScore: z.coerce.number().int().min(0).max(100).optional(),
  maxProspectScore: z.coerce.number().int().min(0).max(100).optional(),
  sortBy: z.enum(['createdAt', 'prospectScore', 'icpFitScore', 'leadQualityScore']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const icpProfileSchema = z.object({
  targetIndustries: z.array(z.string()).default([]),
  targetCountries: z.array(z.string()).default([]),
  targetCompanySizes: z.array(z.string()).default([]),
  targetJobTitles: z.array(z.string()).default([]),
  targetSeniorities: z.array(seniorityEnum).default([]),
  targetKeywords: z.array(z.string()).default([]),
  minWebsiteScore: z.number().int().min(0).max(100).nullable().optional(),
  minOpportunityScore: z.number().int().min(0).max(100).nullable().optional(),
  requireVerifiedEmail: z.boolean().default(false),
  weights: z.object({
    industry: z.number().int().min(0).max(100).default(25),
    location: z.number().int().min(0).max(100).default(15),
    companySize: z.number().int().min(0).max(100).default(15),
    jobTitle: z.number().int().min(0).max(100).default(25),
    seniority: z.number().int().min(0).max(100).default(20),
  }).default({}).refine(
    (w) => w.industry + w.location + w.companySize + w.jobTitle + w.seniority === 100,
    { message: 'Weights must sum to 100' },
  ),
});

export const serviceCatalogSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  matchingSignals: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

// Sending Queue (Module 9)

export const sendingJobStatusSchema = z.enum([
  'PENDING',
  'SCHEDULED',
  'PROCESSING',
  'RETRYING',
  'SENT',
  'FAILED',
  'CANCELLED',
  'PAUSED',
]);

export const sendErrorCategorySchema = z.enum([
  'TEMPORARY',
  'PERMANENT',
  'AUTH',
  'RATE_LIMIT',
  'CONNECTION',
  'BOUNCE',
  'INVALID_ADDRESS',
  'UNKNOWN',
]);

export const sendingJobListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  campaignId: z.string().optional(),
  status: z
    .union([sendingJobStatusSchema, z.array(sendingJobStatusSchema)])
    .optional(),
  mailboxId: z.string().optional(),
  leadId: z.string().optional(),
  errorCategory: sendErrorCategorySchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().max(200).optional(),
});

export const sendingRetrySchema = z.object({}).optional();

export const campaignSendingStatsQuerySchema = z.object({
  campaignId: z.string(),
});

// SMTP Pools / Allocation (Module 10)

export const degradedMailboxPolicySchema = z.enum(['ALLOW', 'DEPRIORITIZE', 'EXCLUDE']);

export const createSmtpPoolSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  strategy: rotationStrategySchema.default('ROUND_ROBIN'),
  enabled: z.boolean().default(true),
});

export const updateSmtpPoolSchema = createSmtpPoolSchema.partial();

export const addPoolMemberSchema = z.object({
  mailboxId: z.string().min(1),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
});

export const updatePoolMemberSchema = z.object({
  priority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

export const updateRotationSettingsSchema = z.object({
  rotationStrategy: rotationStrategySchema.optional(),
  enabled: z.boolean().optional(),
  degradedMailboxPolicy: degradedMailboxPolicySchema.optional(),
});

// Warmup (Module 11)

const warmupTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM');

const warmupWeekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7);

export const warmupSettingsSchema = z.object({
  startingDailyLimit: z.number().int().min(1).max(200).optional(),
  maximumDailyLimit: z.number().int().min(1).max(2000).optional(),
  rampStep: z.number().int().min(1).max(200).optional(),
  rampIntervalHours: z.number().int().min(1).max(24 * 14).optional(),
  timezone: z.string().min(1).max(100).optional(),
  weekdays: warmupWeekdaysSchema.optional(),
  windowStart: warmupTimeSchema.optional(),
  windowEnd: warmupTimeSchema.optional(),
  consecutiveFailureThreshold: z.number().int().min(1).max(20).optional(),
});

export const enableWarmupSchema = warmupSettingsSchema;

export const warmupResetSchema = z.object({
  confirm: z.literal(true),
});

export const createWarmupRecipientSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional().nullable(),
  consentConfirmed: z.literal(true),
});

export const updateWarmupRecipientSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).max(120).optional().nullable(),
    consentConfirmed: z.boolean().optional(),
  })
  .refine(
    (v) => v.enabled !== undefined || v.name !== undefined || v.consentConfirmed !== undefined,
    { message: 'At least one field must be provided' },
  );

export const warmupHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// Inbox (Module 12)

export const replyClassificationSchema = z.enum([
  'INTERESTED',
  'NOT_INTERESTED',
  'QUESTION',
  'NEEDS_FOLLOW_UP',
  'OUT_OF_OFFICE',
  'UNSUBSCRIBE',
  'WRONG_PERSON',
  'REFERRAL',
  'POSITIVE',
  'NEGATIVE',
  'NEUTRAL',
  'UNKNOWN',
]);

export const conversationListQuerySchema = z.object({
  search: z.string().optional(),
  status: z
    .enum([
      'OPEN',
      'NEEDS_RESPONSE',
      'WAITING',
      'INTERESTED',
      'NOT_INTERESTED',
      'UNSUBSCRIBED',
      'CLOSED',
      'ARCHIVED',
    ])
    .optional(),
  classification: replyClassificationSchema.optional(),
  matchStatus: z.enum(['MATCHED', 'UNMATCHED', 'PARTIAL']).optional(),
  mailboxId: z.string().optional(),
  campaignId: z.string().optional(),
  unreadOnly: z.coerce.boolean().optional(),
  assignedUserId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const sendInboxReplySchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  htmlBody: z.string().max(100_000).optional(),
});

export const updateConversationSchema = z
  .object({
    status: z
      .enum([
        'OPEN',
        'NEEDS_RESPONSE',
        'WAITING',
        'INTERESTED',
        'NOT_INTERESTED',
        'UNSUBSCRIBED',
        'CLOSED',
        'ARCHIVED',
      ])
      .optional(),
    classification: replyClassificationSchema.optional(),
    assignedUserId: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.classification !== undefined ||
      v.assignedUserId !== undefined,
    { message: 'At least one field must be provided' },
  );

export const createConversationNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const manualMatchConversationSchema = z.object({
  leadId: z.string().optional().nullable(),
  campaignId: z.string().optional().nullable(),
});

export const mailboxInboundConfigSchema = z.object({
  enabled: z.boolean().optional(),
  imapHost: z.string().min(1).max(255).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUsername: z.string().min(1).max(255).optional().nullable(),
  encryptionType: mailboxEncryptionSchema.optional(),
  syncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  syncFolders: z.array(z.string().min(1)).optional(),
});

export const testImapConnectionSchema = z.object({
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapUsername: z.string().min(1).optional(),
  password: z.string().min(1),
  encryptionType: mailboxEncryptionSchema.default('TLS'),
});

// Deliverability (Module 13)

export const deliverabilityPeriodSchema = z.enum(['today', '7d', '30d']);

export const deliverabilityRangeQuerySchema = z.object({
  period: deliverabilityPeriodSchema.default('7d'),
});

export const deliverabilityReportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  period: deliverabilityPeriodSchema.default('30d'),
});

export const deliverabilityExportQuerySchema = z.object({
  period: deliverabilityPeriodSchema.default('30d'),
  entity: z.enum(['mailboxes', 'campaigns']).default('mailboxes'),
});

export const deliverabilityAlertListQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  entityType: z.enum(['WORKSPACE', 'MAILBOX', 'CAMPAIGN', 'DOMAIN']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const updateDeliverabilityAlertSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
});

export const checkDomainHealthSchema = z.object({
  /// Optional DKIM selector. Without one, DKIM cannot be resolved and is
  /// reported as UNKNOWN rather than a failure.
  dkimSelector: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
});

export const updateDeliverabilityPolicySchema = z
  .object({
    protection: z
      .object({
        pauseOnCriticalBounceRate: z.boolean().optional(),
        pauseLeadOnHardBounce: z.boolean().optional(),
        stopOnUnsubscribed: z.boolean().optional(),
        reduceSendingOnCritical: z.boolean().optional(),
        blockRecipientsAtRisk: z.boolean().optional(),
      })
      .optional(),
    thresholds: z
      .object({
        excellent: z.number().int().min(0).max(100).optional(),
        healthy: z.number().int().min(0).max(100).optional(),
        needsAttention: z.number().int().min(0).max(100).optional(),
        atRisk: z.number().int().min(0).max(100).optional(),
        criticalBounceRatePercent: z.number().min(0).max(100).optional(),
        warningBounceRatePercent: z.number().min(0).max(100).optional(),
        criticalFailureRatePercent: z.number().min(0).max(100).optional(),
        warningFailureRatePercent: z.number().min(0).max(100).optional(),
        warningUnsubscribeRatePercent: z.number().min(0).max(100).optional(),
        softBounceThreshold: z.number().int().min(1).max(20).optional(),
        softBounceSuppressThreshold: z.number().int().min(0).max(50).optional(),
        minimumVolumeForRates: z.number().int().min(1).optional(),
        velocityAnomalyMultiplier: z.number().min(1).optional(),
        dnsCacheTtlHours: z.number().int().min(1).max(168).optional(),
        dnsRecheckCooldownMinutes: z.number().int().min(1).optional(),
      })
      .optional(),
  })
  .refine((v) => v.protection !== undefined || v.thresholds !== undefined, {
    message: 'At least one of protection or thresholds must be provided',
  });

export const resumeMailboxSendingSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const analyzeDeliverabilitySchema = z.object({
  mailboxId: z.string().min(1),
  period: deliverabilityPeriodSchema.default('7d'),
});

// Analytics (Module 14)

export const analyticsPeriodSchema = z.enum([
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'custom',
]);

/// Shared by every analytics read endpoint. `startDate`/`endDate` are only read
/// when `period` is `custom`; the range resolver rejects inverted or oversized
/// windows rather than clamping them silently.
export const analyticsRangeQuerySchema = z.object({
  period: analyticsPeriodSchema.default('7d'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  campaignId: z.string().min(1).optional(),
  mailboxId: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
});

export const analyticsExportQuerySchema = analyticsRangeQuerySchema.extend({
  entity: z
    .enum([
      'campaigns',
      'mailboxes',
      'sequences',
      'funnel',
      'timeline',
      'sources',
      'industries',
      'geography',
      'job-titles',
      'discovery',
    ])
    .default('campaigns'),
});

export const analyticsOutcomeListQuerySchema = z.object({
  type: z.enum(['MEETING_BOOKED', 'QUALIFIED', 'CONVERTED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const recordLeadOutcomeSchema = z.object({
  leadId: z.string().min(1),
  type: z.enum(['MEETING_BOOKED', 'QUALIFIED', 'CONVERTED']),
  campaignId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  occurredAt: z.coerce.date().optional(),
  note: z.string().max(1000).optional(),
});

export const analyzeAnalyticsSchema = z.object({
  period: analyticsPeriodSchema.default('30d'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  campaignId: z.string().min(1).optional(),
});

// ─── Automations (Module 15) ─────────────────────────────────────────────────

export const workflowStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  nodes: z.array(z.record(z.unknown())).optional(),
  edges: z.array(z.record(z.unknown())).optional(),
});

export const createWorkflowFromTemplateSchema = z.object({
  templateId: z.string().min(1),
});

export const workflowListQuerySchema = z.object({
  status: workflowStatusSchema.optional(),
});

export const workflowExecutionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const workflowLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const notificationListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});


// ─── Lead Discovery (Module 16) ──────────────────────────────────────────────

export const discoverySourceEnum = z.enum([
  'CSV', 'XLSX', 'GOOGLE_PLACES', 'GOOGLE_MAPS_SCRAPER', 'MOCK', 'MANUAL', 'YELP', 'CLUTCH', 'YELLOW_PAGES',
]);

export const discoveryStatusEnum = z.enum([
  'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED',
]);

export const discoveryStageEnum = z.enum([
  'DISCOVERED', 'NORMALIZED', 'DEDUPLICATED', 'ENRICHED', 'WEBSITE_ANALYZED',
  'EMAIL_DISCOVERED', 'EMAIL_CHECKED', 'QUALIFIED', 'AI_RESEARCHED', 'READY',
  'CAMPAIGN_ENROLLED', 'FAILED',
]);

export const discoverySearchSchema = z.object({
  country: z.string().max(100).optional(),
  countryCode: z.string().length(2).optional(),
  state: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  industry: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(10).optional(),
  radiusMeters: z.number().int().min(100).max(50_000).optional(),
  // Upper bound is a cost and fan-out guard, not a UI preference.
  maxResults: z.number().int().min(1).max(500).default(50),
  requireWebsite: z.boolean().default(false),
  requirePhone: z.boolean().default(false),
  requireEmail: z.boolean().default(false),
  minScore: z.number().int().min(0).max(100).default(0),
});

export const createDiscoveryJobSchema = z.object({
  source: discoverySourceEnum,
  name: z.string().min(1).max(120).optional(),
  query: discoverySearchSchema,
  /// Base64 file content for CSV/XLSX sources.
  file: z
    .object({
      data: z.string().min(1),
      mimeType: z.string().min(1),
      filename: z.string().min(1).optional(),
      columnMappings: z.record(z.string()).optional(),
    })
    .optional(),
});

export const discoveryJobListQuerySchema = z.object({
  status: discoveryStatusEnum.optional(),
  source: discoverySourceEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const verificationStatusEnum = z.enum([
  'VERIFIED', 'RISKY', 'INVALID', 'UNKNOWN', 'DISPOSABLE', 'ROLE_BASED',
]);

export const discoveryResultsQuerySchema = z.object({
  qualified: z.coerce.boolean().optional(),
  isDuplicate: z.coerce.boolean().optional(),
  hasEmail: z.coerce.boolean().optional(),
  hasWebsite: z.coerce.boolean().optional(),
  hasPhone: z.coerce.boolean().optional(),
  stage: discoveryStageEnum.optional(),
  emailStatus: verificationStatusEnum.optional(),
  country: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['createdAt', 'icpFitScore', 'company', 'email']).default('icpFitScore'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const saveDiscoveredLeadsSchema = z.object({
  discoveredLeadIds: z.array(z.string().min(1)).min(1).max(500),
});

export const enrollDiscoveredLeadsSchema = z.object({
  discoveredLeadIds: z.array(z.string().min(1)).min(1).max(500),
  campaignId: z.string().min(1),
  force: z.boolean().default(false),
});

export const discoveryImportPreviewSchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().min(1),
  filename: z.string().min(1).optional(),
});

export const discoveryExportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  qualified: z.coerce.boolean().optional(),
});

export const updateLeadSourceConfigSchema = z.object({
  source: discoverySourceEnum,
  enabled: z.boolean(),
});

// ─── Lead Research (Module 17) ───────────────────────────────────────────────

export const researchSourceEnum = z.enum(['LINKEDIN', 'WEBSITE', 'FACEBOOK', 'YOUTUBE', 'REDDIT', 'WEB', 'OTHER']);
export const researchTypeEnum = z.enum(['COMPANY', 'PERSON', 'JOB', 'OTHER']);
export const researchStatusEnum = z.enum([
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIAL',
  'MANUAL_REVIEW',
  'FAILED',
  'UNAVAILABLE',
]);
export const researchConfidenceEnum = z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
export const researchProviderNameEnum = z.enum(['manual', 'public', 'agent-reach']);

export const researchLeadSchema = z
  .object({
    leadId: z.string().min(1),
    companyUrl: linkedinUrlSchema.optional(),
    personUrl: linkedinUrlSchema.optional(),
    forceRefresh: z.boolean().default(false),
  })
  .refine((body) => Boolean(body.companyUrl || body.personUrl), {
    message: 'Provide companyUrl and/or personUrl',
  });

export const approveResearchSchema = z
  .object({
    researchIds: z.array(z.string().min(1)).max(500).optional(),
    leadIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .refine((body) => (body.researchIds?.length ?? 0) + (body.leadIds?.length ?? 0) > 0, {
    message: 'Provide researchIds and/or leadIds',
  });

const manualVerificationPersonSchema = z
  .object({
    firstName: z.string().trim().max(120),
    lastName: z.string().trim().max(120),
    title: z.string().trim().max(200),
    profileUrl: optionalLinkedinUrlSchema,
  })
  .partial();

const manualVerificationCompanySchema = z
  .object({
    name: z.string().trim().max(200),
    url: optionalLinkedinUrlSchema,
    industry: z.string().trim().max(120),
    location: z.string().trim().max(200),
    employeeRange: z.string().trim().max(60),
  })
  .partial();

const manualVerificationSignalsSchema = z
  .object({
    decisionMaker: z.boolean().nullable(),
    hiring: z.boolean().nullable(),
    growthSignal: z.boolean().nullable(),
    technologySignal: z.boolean().nullable(),
  })
  .partial();

/// What a researcher confirmed by hand. Every supplied field is stored with
/// source MANUAL and verification VERIFIED — so only send what was actually checked.
export const manualVerificationSchema = z
  .object({
    person: manualVerificationPersonSchema.optional(),
    company: manualVerificationCompanySchema.optional(),
    signals: manualVerificationSignalsSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((body) => Boolean(body.person || body.company || body.signals), {
    message: 'Provide at least one verified field',
  });

export const researchQueueQuerySchema = z.object({
  status: researchStatusEnum.optional(),
  source: researchSourceEnum.optional(),
  researchType: researchTypeEnum.optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const updateResearchProviderSchema = z.object({
  source: researchSourceEnum.default('LINKEDIN'),
  provider: researchProviderNameEnum,
  enabled: z.boolean(),
});

export const researchHealthCheckSchema = z.object({
  provider: researchProviderNameEnum.optional(),
});

// --- Security hardening schemas (Stage 15) ---

export const csvImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1).max(10000),
  mappings: z.record(z.string(), z.string()),
  skipDuplicates: z.boolean().default(true),
  verifyOnImport: z.boolean().default(false),
});

export const leadTagAssignmentSchema = z.object({
  tagIds: z.array(z.string().min(1)).min(1).max(100),
});

export const listMemberAddSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
});

export const webResearchRequestSchema = z.object({
  leadId: z.string().min(1),
  websiteUrl: z.string().url().optional(),
  forceRefresh: z.boolean().default(false),
});

export const suppressionListQuerySchema = z.object({
  type: z.enum(['EMAIL', 'DOMAIN']).optional(),
  reason: z.enum(['MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'SPAM_COMPLAINT', 'INVALID', 'RISKY']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
