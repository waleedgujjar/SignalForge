import { describe, expect, it } from 'vitest';
import {
  // Health
  healthStatusSchema,
  healthResponseSchema,
  dependencyHealthSchema,
  // Auth
  passwordSchema,
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailTokenSchema,
  // Workspace
  primaryUseCaseSchema,
  onboardingSchema,
  createWorkspaceSchema,
  updateWorkspaceSettingsSchema,
  updateProfileSchema,
  switchWorkspaceSchema,
  sessionResponseSchema,
  // Mailbox
  mailboxProviderSchema,
  mailboxEncryptionSchema,
  mailboxStatusSchema,
  mailboxHealthStatusSchema,
  smtpErrorCategorySchema,
  createMailboxSchema,
  updateMailboxSchema,
  testConnectionSchema,
  mailboxListQuerySchema,
  bulkMailboxActionSchema,
  mailboxTestHistoryQuerySchema,
  // Campaign
  delayUnitSchema,
  stepTypeSchema,
  duplicateEnrollmentPolicySchema,
  scheduleConfigSchema,
  campaignStepSchema,
  createCampaignStepSchema,
  createCampaignSchema,
  updateCampaignSchema,
  campaignListQuerySchema,
  enrollCampaignLeadsSchema,
  reorderCampaignStepsSchema,
  stopCampaignSchema,
  launchCampaignSchema,
  replyHandlingPolicySchema,
  followUpConfigSchema,
  disableFollowUpsSchema,
  validateTemplateSchema,
  previewEmailSchema,
  // Lead
  leadStatusEnum,
  leadSourceEnum,
  linkedinUrlSchema,
  optionalLinkedinUrlSchema,
  createLeadSchema,
  updateLeadSchema,
  leadListQuerySchema,
  bulkLeadActionSchema,
  bulkTagSchema,
  bulkListSchema,
  bulkStatusSchema,
  // Tags
  createTagSchema,
  updateTagSchema,
  // Lead Lists
  createLeadListSchema,
  updateLeadListSchema,
  // Lead Notes
  createLeadNoteSchema,
  // CSV Import (column mapping)
  csvColumnMappingSchema,
  // Suppression
  createSuppressionSchema,
  bulkSuppressionSchema,
  // Verification
  verifyEmailSchema,
  bulkVerifySchema,
  // Custom fields
  createCustomFieldSchema,
  // Integrations
  integrationProviderEnum,
  connectIntegrationSchema,
  oauthCallbackSchema,
  // Drive Import
  driveImportSchema,
  // Website Intelligence
  analyzeWebsiteSchema,
  batchAnalyzeSchema,
  // Lead Enrichment
  enrichLeadSchema,
  batchEnrichSchema,
  icpProfileSchema,
  // Warmup
  warmupSettingsSchema,
  warmupResetSchema,
  createWarmupRecipientSchema,
  updateWarmupRecipientSchema,
  // Inbox
  sendInboxReplySchema,
  updateConversationSchema,
  createConversationNoteSchema,
  testImapConnectionSchema,
  // Deliverability
  deliverabilityPeriodSchema,
  checkDomainHealthSchema,
  updateDeliverabilityPolicySchema,
  // Analytics
  analyticsPeriodSchema,
  analyticsRangeQuerySchema,
  recordLeadOutcomeSchema,
  // Automations
  createWorkflowSchema,
  updateWorkflowSchema,
  workflowListQuerySchema,
  // Discovery
  discoverySearchSchema,
  createDiscoveryJobSchema,
  saveDiscoveredLeadsSchema,
  enrollDiscoveredLeadsSchema,
  // Research
  researchLeadSchema,
  approveResearchSchema,
  manualVerificationSchema,
  // Stage 15
  csvImportSchema,
  leadTagAssignmentSchema,
  listMemberAddSchema,
  webResearchRequestSchema,
  suppressionListQuerySchema,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expect parsing to succeed and return the parsed value. */
function expectValid<T>(schema: { parse: (v: unknown) => T }, data: unknown): T {
  return schema.parse(data);
}

/** Expect parsing to throw a ZodError. */
function expectInvalid(schema: { parse: (v: unknown) => unknown }, data: unknown): void {
  expect(() => schema.parse(data)).toThrow();
}

// ---------------------------------------------------------------------------
// Health schemas
// ---------------------------------------------------------------------------

describe('healthStatusSchema', () => {
  it('accepts valid values', () => {
    expect(healthStatusSchema.parse('ok')).toBe('ok');
    expect(healthStatusSchema.parse('degraded')).toBe('degraded');
    expect(healthStatusSchema.parse('error')).toBe('error');
  });

  it('rejects invalid values', () => {
    expectInvalid(healthStatusSchema, 'unknown');
    expectInvalid(healthStatusSchema, '');
    expectInvalid(healthStatusSchema, 123);
  });
});

describe('healthResponseSchema', () => {
  const valid = {
    status: 'ok',
    service: 'api',
    timestamp: '2024-01-01T00:00:00Z',
  };

  it('accepts valid data', () => {
    const result = expectValid(healthResponseSchema, valid);
    expect(result.status).toBe('ok');
    expect(result.version).toBeUndefined();
  });

  it('accepts optional version', () => {
    const result = expectValid(healthResponseSchema, { ...valid, version: '1.0.0' });
    expect(result.version).toBe('1.0.0');
  });

  it('rejects missing required fields', () => {
    expectInvalid(healthResponseSchema, {});
    expectInvalid(healthResponseSchema, { status: 'ok' });
    expectInvalid(healthResponseSchema, { status: 'ok', service: 'api' });
  });

  it('rejects invalid timestamp', () => {
    expectInvalid(healthResponseSchema, { ...valid, timestamp: 'not-a-date' });
  });
});

describe('dependencyHealthSchema', () => {
  it('accepts valid data with optional fields', () => {
    const result = expectValid(dependencyHealthSchema, {
      status: 'degraded',
      service: 'db',
      timestamp: '2024-06-01T12:00:00Z',
      latencyMs: 42,
      error: 'timeout',
    });
    expect(result.latencyMs).toBe(42);
  });

  it('rejects negative latency', () => {
    expectInvalid(dependencyHealthSchema, {
      status: 'ok',
      service: 'db',
      timestamp: '2024-06-01T12:00:00Z',
      latencyMs: -1,
    });
  });
});

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

describe('passwordSchema', () => {
  it('accepts a valid password', () => {
    expect(passwordSchema.parse('Abcdefg1')).toBe('Abcdefg1');
  });

  it('rejects too short', () => {
    expectInvalid(passwordSchema, 'Ab1');
  });

  it('rejects missing lowercase', () => {
    expectInvalid(passwordSchema, 'ABCDEFG1');
  });

  it('rejects missing uppercase', () => {
    expectInvalid(passwordSchema, 'abcdefg1');
  });

  it('rejects missing number', () => {
    expectInvalid(passwordSchema, 'Abcdefgh');
  });
});

describe('signupSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'Password1',
    confirmPassword: 'Password1',
    name: 'Alice',
  };

  it('accepts valid signup data', () => {
    const result = expectValid(signupSchema, valid);
    expect(result.email).toBe('user@example.com');
  });

  it('rejects mismatched passwords', () => {
    expectInvalid(signupSchema, { ...valid, confirmPassword: 'Different1' });
  });

  it('rejects invalid email', () => {
    expectInvalid(signupSchema, { ...valid, email: 'not-an-email' });
  });

  it('rejects empty name', () => {
    expectInvalid(signupSchema, { ...valid, name: '' });
  });

  it('rejects missing fields', () => {
    expectInvalid(signupSchema, {});
    expectInvalid(signupSchema, { email: 'a@b.com' });
  });

  it('rejects weak password through signup', () => {
    expectInvalid(signupSchema, { ...valid, password: 'weak', confirmPassword: 'weak' });
  });
});

describe('loginSchema', () => {
  it('accepts valid login', () => {
    const result = expectValid(loginSchema, {
      email: 'user@example.com',
      password: 'anything',
    });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    expectInvalid(loginSchema, { email: 'bad', password: 'x' });
  });

  it('rejects empty password', () => {
    expectInvalid(loginSchema, { email: 'user@example.com', password: '' });
  });

  it('rejects missing fields', () => {
    expectInvalid(loginSchema, {});
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts valid email', () => {
    expectValid(forgotPasswordSchema, { email: 'user@example.com' });
  });

  it('rejects invalid email', () => {
    expectInvalid(forgotPasswordSchema, { email: '' });
    expectInvalid(forgotPasswordSchema, { email: 'nope' });
  });
});

describe('resetPasswordSchema', () => {
  const valid = {
    token: 'abc123',
    password: 'Password1',
    confirmPassword: 'Password1',
  };

  it('accepts valid data', () => {
    expectValid(resetPasswordSchema, valid);
  });

  it('rejects mismatched passwords', () => {
    expectInvalid(resetPasswordSchema, { ...valid, confirmPassword: 'Other1234' });
  });

  it('rejects empty token', () => {
    expectInvalid(resetPasswordSchema, { ...valid, token: '' });
  });

  it('rejects weak password', () => {
    expectInvalid(resetPasswordSchema, {
      ...valid,
      password: 'short',
      confirmPassword: 'short',
    });
  });
});

describe('verifyEmailTokenSchema', () => {
  it('accepts non-empty token', () => {
    expectValid(verifyEmailTokenSchema, { token: 'tok' });
  });

  it('rejects empty token', () => {
    expectInvalid(verifyEmailTokenSchema, { token: '' });
  });
});

// ---------------------------------------------------------------------------
// Workspace schemas
// ---------------------------------------------------------------------------

describe('primaryUseCaseSchema', () => {
  it('accepts all valid values', () => {
    for (const v of ['LEAD_GENERATION', 'COLD_EMAIL', 'SALES_OUTREACH', 'AGENCY', 'OTHER']) {
      expect(primaryUseCaseSchema.parse(v)).toBe(v);
    }
  });

  it('rejects invalid value', () => {
    expectInvalid(primaryUseCaseSchema, 'INVALID');
  });
});

describe('onboardingSchema', () => {
  it('accepts valid data', () => {
    const result = expectValid(onboardingSchema, { workspaceName: 'My Workspace' });
    expect(result.primaryUseCase).toBeUndefined();
  });

  it('accepts with optional primaryUseCase', () => {
    const result = expectValid(onboardingSchema, {
      workspaceName: 'WS',
      primaryUseCase: 'COLD_EMAIL',
    });
    expect(result.primaryUseCase).toBe('COLD_EMAIL');
  });

  it('rejects empty workspace name', () => {
    expectInvalid(onboardingSchema, { workspaceName: '' });
  });

  it('rejects missing workspace name', () => {
    expectInvalid(onboardingSchema, {});
  });
});

describe('createWorkspaceSchema', () => {
  it('accepts valid name', () => {
    expectValid(createWorkspaceSchema, { name: 'Workspace' });
  });

  it('rejects empty name', () => {
    expectInvalid(createWorkspaceSchema, { name: '' });
  });
});

describe('updateWorkspaceSettingsSchema', () => {
  it('accepts partial update', () => {
    const result = expectValid(updateWorkspaceSettingsSchema, { name: 'New Name' });
    expect(result.name).toBe('New Name');
    expect(result.timezone).toBeUndefined();
  });

  it('accepts nullable fields', () => {
    const result = expectValid(updateWorkspaceSettingsSchema, {
      defaultFromName: null,
      defaultReplyTo: null,
      logoUrl: null,
    });
    expect(result.defaultFromName).toBeNull();
  });

  it('rejects invalid replyTo email', () => {
    expectInvalid(updateWorkspaceSettingsSchema, { defaultReplyTo: 'not-email' });
  });
});

describe('updateProfileSchema', () => {
  it('accepts all nullable fields', () => {
    const result = expectValid(updateProfileSchema, {
      firstName: null,
      lastName: null,
      name: null,
      avatarUrl: null,
    });
    expect(result.firstName).toBeNull();
  });

  it('accepts empty object', () => {
    expectValid(updateProfileSchema, {});
  });
});

describe('switchWorkspaceSchema', () => {
  it('accepts valid workspace id', () => {
    expectValid(switchWorkspaceSchema, { workspaceId: 'ws_123' });
  });

  it('rejects empty workspace id', () => {
    expectInvalid(switchWorkspaceSchema, { workspaceId: '' });
  });
});

describe('sessionResponseSchema', () => {
  const valid = {
    user: { id: 'u1', email: 'a@b.com', name: null },
    needsOnboarding: true,
  };

  it('accepts valid data with defaults', () => {
    const result = expectValid(sessionResponseSchema, valid);
    expect(result.workspaces).toEqual([]);
    expect(result.needsOnboarding).toBe(true);
  });

  it('accepts full data', () => {
    const result = expectValid(sessionResponseSchema, {
      ...valid,
      workspace: { id: 'w1', name: 'WS', slug: 'ws', role: 'OWNER' },
      workspaces: [{ id: 'w1', name: 'WS', slug: 'ws', role: 'ADMIN' }],
      role: 'ADMIN',
    });
    expect(result.workspaces).toHaveLength(1);
  });

  it('rejects invalid role', () => {
    expectInvalid(sessionResponseSchema, {
      ...valid,
      role: 'SUPERADMIN',
    });
  });
});

// ---------------------------------------------------------------------------
// Mailbox schemas
// ---------------------------------------------------------------------------

describe('mailbox enum schemas', () => {
  it('mailboxProviderSchema accepts valid values', () => {
    for (const v of ['SMTP', 'GOOGLE_OAUTH', 'MICROSOFT_OAUTH']) {
      expect(mailboxProviderSchema.parse(v)).toBe(v);
    }
  });

  it('mailboxEncryptionSchema accepts valid values', () => {
    for (const v of ['NONE', 'TLS', 'SSL']) {
      expect(mailboxEncryptionSchema.parse(v)).toBe(v);
    }
  });

  it('mailboxStatusSchema accepts valid values', () => {
    for (const v of ['UNVERIFIED', 'ACTIVE', 'DISABLED', 'PAUSED', 'ERROR', 'DISCONNECTED']) {
      expect(mailboxStatusSchema.parse(v)).toBe(v);
    }
  });

  it('mailboxHealthStatusSchema accepts valid values', () => {
    for (const v of ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']) {
      expect(mailboxHealthStatusSchema.parse(v)).toBe(v);
    }
  });

  it('smtpErrorCategorySchema accepts valid values', () => {
    expectValid(smtpErrorCategorySchema, 'AUTH_FAILED');
    expectValid(smtpErrorCategorySchema, 'UNKNOWN');
  });
});

describe('createMailboxSchema', () => {
  const valid = {
    emailAddress: 'test@example.com',
    fromName: 'Tester',
  };

  it('accepts minimal valid data with defaults', () => {
    const result = expectValid(createMailboxSchema, valid);
    expect(result.provider).toBe('SMTP');
    expect(result.encryptionType).toBe('TLS');
    expect(result.dailySendingLimit).toBe(100);
  });

  it('accepts full SMTP config', () => {
    const result = expectValid(createMailboxSchema, {
      ...valid,
      provider: 'SMTP',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUsername: 'user',
      smtpPassword: 'pass',
      name: 'My Mailbox',
      dailySendingLimit: 500,
    });
    expect(result.smtpPort).toBe(587);
    expect(result.dailySendingLimit).toBe(500);
  });

  it('rejects invalid email address', () => {
    expectInvalid(createMailboxSchema, { ...valid, emailAddress: 'bad' });
  });

  it('rejects empty fromName', () => {
    expectInvalid(createMailboxSchema, { ...valid, fromName: '' });
  });

  it('rejects port out of range', () => {
    expectInvalid(createMailboxSchema, { ...valid, smtpPort: 0 });
    expectInvalid(createMailboxSchema, { ...valid, smtpPort: 70000 });
  });

  it('rejects dailySendingLimit out of range', () => {
    expectInvalid(createMailboxSchema, { ...valid, dailySendingLimit: 0 });
    expectInvalid(createMailboxSchema, { ...valid, dailySendingLimit: 20000 });
  });

  it('rejects invalid hostname', () => {
    expectInvalid(createMailboxSchema, { ...valid, smtpHost: '' });
    expectInvalid(createMailboxSchema, { ...valid, smtpHost: '-invalid.com' });
  });

  it('accepts valid hostname', () => {
    const result = expectValid(createMailboxSchema, {
      ...valid,
      smtpHost: 'mail.example.com',
    });
    expect(result.smtpHost).toBe('mail.example.com');
  });
});

describe('updateMailboxSchema', () => {
  it('accepts partial update', () => {
    const result = expectValid(updateMailboxSchema, { fromName: 'Updated' });
    expect(result.fromName).toBe('Updated');
  });

  it('accepts status field', () => {
    const result = expectValid(updateMailboxSchema, { status: 'ACTIVE' });
    expect(result.status).toBe('ACTIVE');
  });

  it('accepts empty object (all optional)', () => {
    expectValid(updateMailboxSchema, {});
  });
});

describe('testConnectionSchema', () => {
  const valid = {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUsername: 'user',
    smtpPassword: 'pass',
    emailAddress: 'test@example.com',
    fromName: 'Tester',
  };

  it('accepts valid data', () => {
    const result = expectValid(testConnectionSchema, valid);
    expect(result.encryptionType).toBe('TLS');
  });

  it('rejects missing required fields', () => {
    expectInvalid(testConnectionSchema, {});
    expectInvalid(testConnectionSchema, { smtpHost: 'smtp.example.com' });
  });
});

describe('mailboxListQuerySchema', () => {
  it('accepts empty query', () => {
    expectValid(mailboxListQuerySchema, {});
  });

  it('accepts valid filters', () => {
    const result = expectValid(mailboxListQuerySchema, {
      status: 'ACTIVE',
      healthStatus: 'HEALTHY',
      search: 'test',
    });
    expect(result.status).toBe('ACTIVE');
  });
});

describe('bulkMailboxActionSchema', () => {
  it('accepts valid data', () => {
    const result = expectValid(bulkMailboxActionSchema, {
      mailboxIds: ['id1'],
      action: 'ENABLE',
    });
    expect(result.action).toBe('ENABLE');
  });

  it('rejects empty mailboxIds', () => {
    expectInvalid(bulkMailboxActionSchema, { mailboxIds: [], action: 'ENABLE' });
  });

  it('rejects too many mailboxIds', () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expectInvalid(bulkMailboxActionSchema, { mailboxIds: ids, action: 'DISABLE' });
  });

  it('rejects invalid action', () => {
    expectInvalid(bulkMailboxActionSchema, { mailboxIds: ['x'], action: 'DELETE' });
  });
});

describe('mailboxTestHistoryQuerySchema', () => {
  it('applies defaults', () => {
    const result = expectValid(mailboxTestHistoryQuerySchema, {});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('coerces string numbers', () => {
    const result = expectValid(mailboxTestHistoryQuerySchema, { page: '3', limit: '50' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('rejects limit > 100', () => {
    expectInvalid(mailboxTestHistoryQuerySchema, { limit: 101 });
  });
});

// ---------------------------------------------------------------------------
// Campaign schemas
// ---------------------------------------------------------------------------

describe('campaign enum schemas', () => {
  it('delayUnitSchema', () => {
    for (const v of ['MINUTES', 'HOURS', 'DAYS']) {
      expect(delayUnitSchema.parse(v)).toBe(v);
    }
    expectInvalid(delayUnitSchema, 'WEEKS');
  });

  it('stepTypeSchema', () => {
    expect(stepTypeSchema.parse('EMAIL')).toBe('EMAIL');
    expectInvalid(stepTypeSchema, 'SMS');
  });

  it('duplicateEnrollmentPolicySchema', () => {
    for (const v of ['BLOCK', 'ALLOW', 'WARN']) {
      expect(duplicateEnrollmentPolicySchema.parse(v)).toBe(v);
    }
  });
});

describe('scheduleConfigSchema', () => {
  it('accepts valid schedule', () => {
    const result = expectValid(scheduleConfigSchema, {
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '17:00',
      minDelayMinutes: 5,
      maxDelayMinutes: 30,
    });
    expect(result.days).toHaveLength(5);
  });

  it('accepts empty config', () => {
    expectValid(scheduleConfigSchema, {});
  });

  it('rejects invalid time format', () => {
    expectInvalid(scheduleConfigSchema, { startTime: '9:00' });
    expectInvalid(scheduleConfigSchema, { startTime: 'noon' });
    expectInvalid(scheduleConfigSchema, { endTime: '5pm' });
  });

  it('rejects maxDelayMinutes < minDelayMinutes', () => {
    expectInvalid(scheduleConfigSchema, { minDelayMinutes: 30, maxDelayMinutes: 10 });
  });

  it('rejects day out of range', () => {
    expectInvalid(scheduleConfigSchema, { days: [7] });
    expectInvalid(scheduleConfigSchema, { days: [-1] });
  });

  it('rejects delay out of range', () => {
    expectInvalid(scheduleConfigSchema, { minDelayMinutes: -1 });
    expectInvalid(scheduleConfigSchema, { maxDelayMinutes: 1441 });
  });
});

describe('campaignStepSchema', () => {
  const valid = {
    order: 0,
    subjectTemplate: 'Hello {{firstName}}',
    bodyTemplate: '<p>Hi</p>',
  };

  it('accepts valid step with defaults', () => {
    const result = expectValid(campaignStepSchema, valid);
    expect(result.type).toBe('EMAIL');
    expect(result.delayDays).toBe(0);
    expect(result.delayAmount).toBe(0);
    expect(result.delayUnit).toBe('DAYS');
    expect(result.enabled).toBe(true);
  });

  it('rejects empty subject template', () => {
    expectInvalid(campaignStepSchema, { ...valid, subjectTemplate: '' });
  });

  it('rejects empty body template', () => {
    expectInvalid(campaignStepSchema, { ...valid, bodyTemplate: '' });
  });

  it('rejects negative order', () => {
    expectInvalid(campaignStepSchema, { ...valid, order: -1 });
  });
});

describe('createCampaignStepSchema', () => {
  it('accepts step without order', () => {
    const result = expectValid(createCampaignStepSchema, {
      subjectTemplate: 'Subject',
      bodyTemplate: 'Body',
    });
    expect(result.order).toBeUndefined();
  });

  it('accepts step with order', () => {
    const result = expectValid(createCampaignStepSchema, {
      order: 2,
      subjectTemplate: 'Subject',
      bodyTemplate: 'Body',
    });
    expect(result.order).toBe(2);
  });
});

describe('createCampaignSchema', () => {
  const valid = { name: 'My Campaign' };

  it('accepts minimal data with defaults', () => {
    const result = expectValid(createCampaignSchema, valid);
    expect(result.rotationStrategy).toBe('HEALTH_AWARE');
    expect(result.sendingMode).toBe('MAILBOX_LIST');
    expect(result.duplicateEnrollmentPolicy).toBe('BLOCK');
    expect(result.mailboxIds).toEqual([]);
    expect(result.leadIds).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it('accepts full data', () => {
    const result = expectValid(createCampaignSchema, {
      name: 'Campaign',
      description: 'Description',
      rotationStrategy: 'ROUND_ROBIN',
      sendingMode: 'SMTP_POOL',
      dailySendingLimit: 50,
      mailboxIds: ['m1', 'm2'],
      leadIds: ['l1'],
      steps: [
        {
          order: 0,
          subjectTemplate: 'Subj',
          bodyTemplate: 'Body',
        },
      ],
    });
    expect(result.steps).toHaveLength(1);
  });

  it('rejects empty name', () => {
    expectInvalid(createCampaignSchema, { name: '' });
  });

  it('rejects description over 2000 chars', () => {
    expectInvalid(createCampaignSchema, { name: 'C', description: 'x'.repeat(2001) });
  });
});

describe('updateCampaignSchema', () => {
  it('accepts partial update', () => {
    const result = expectValid(updateCampaignSchema, { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('accepts scheduledAt datetime', () => {
    const result = expectValid(updateCampaignSchema, {
      scheduledAt: '2024-12-01T10:00:00Z',
    });
    expect(result.scheduledAt).toBe('2024-12-01T10:00:00Z');
  });

  it('accepts replyHandlingPolicy', () => {
    const result = expectValid(updateCampaignSchema, {
      replyHandlingPolicy: { pauseOnReply: true },
    });
    expect(result.replyHandlingPolicy?.pauseOnReply).toBe(true);
  });

  it('accepts empty object', () => {
    expectValid(updateCampaignSchema, {});
  });
});

describe('campaignListQuerySchema', () => {
  it('applies defaults', () => {
    const result = expectValid(campaignListQuerySchema, {});
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortOrder).toBe('desc');
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts valid filters', () => {
    const result = expectValid(campaignListQuerySchema, {
      search: 'test',
      status: 'ACTIVE',
      sortBy: 'name',
      sortOrder: 'asc',
      page: '2',
      limit: '50',
    });
    expect(result.page).toBe(2);
    expect(result.status).toBe('ACTIVE');
  });

  it('rejects invalid status', () => {
    expectInvalid(campaignListQuerySchema, { status: 'INVALID_STATUS' });
  });

  it('rejects limit over 100', () => {
    expectInvalid(campaignListQuerySchema, { limit: 101 });
  });
});

describe('enrollCampaignLeadsSchema', () => {
  it('accepts valid data', () => {
    const result = expectValid(enrollCampaignLeadsSchema, {
      leadIds: ['id1', 'id2'],
    });
    expect(result.force).toBe(false);
  });

  it('rejects empty leadIds', () => {
    expectInvalid(enrollCampaignLeadsSchema, { leadIds: [] });
  });

  it('rejects more than 500 leadIds', () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id${i}`);
    expectInvalid(enrollCampaignLeadsSchema, { leadIds: ids });
  });
});

describe('reorderCampaignStepsSchema', () => {
  it('accepts valid step ids', () => {
    expectValid(reorderCampaignStepsSchema, { orderedStepIds: ['s1', 's2'] });
  });

  it('rejects empty array', () => {
    expectInvalid(reorderCampaignStepsSchema, { orderedStepIds: [] });
  });
});

describe('stopCampaignSchema', () => {
  it('accepts confirmed=true', () => {
    expectValid(stopCampaignSchema, { confirmed: true });
  });

  it('rejects confirmed=false', () => {
    expectInvalid(stopCampaignSchema, { confirmed: false });
  });

  it('accepts optional reason', () => {
    const result = expectValid(stopCampaignSchema, {
      confirmed: true,
      reason: 'No longer needed',
    });
    expect(result.reason).toBe('No longer needed');
  });
});

describe('launchCampaignSchema', () => {
  it('accepts empty object via default', () => {
    expectValid(launchCampaignSchema, {});
  });
});

describe('replyHandlingPolicySchema', () => {
  it('applies defaults', () => {
    const result = expectValid(replyHandlingPolicySchema, {});
    expect(result.pauseOnReply).toBe(false);
    expect(result.stopOnReply).toBe(true);
    expect(result.autoArchiveOoo).toBe(false);
    expect(result.detectUnsubscribe).toBe(true);
  });
});

describe('followUpConfigSchema', () => {
  it('applies defaults', () => {
    const result = expectValid(followUpConfigSchema, {});
    expect(result.followUpsEnabled).toBe(false);
    expect(result.maxFollowUps).toBe(5);
  });

  it('rejects maxFollowUps > 5', () => {
    expectInvalid(followUpConfigSchema, { maxFollowUps: 6 });
  });

  it('rejects maxFollowUps < 1', () => {
    expectInvalid(followUpConfigSchema, { maxFollowUps: 0 });
  });
});

describe('disableFollowUpsSchema', () => {
  it('accepts confirmed=true', () => {
    expectValid(disableFollowUpsSchema, { confirmed: true });
  });

  it('rejects confirmed=false', () => {
    expectInvalid(disableFollowUpsSchema, { confirmed: false });
  });
});

describe('validateTemplateSchema', () => {
  it('accepts valid data', () => {
    expectValid(validateTemplateSchema, {
      subjectTemplate: 'Hello',
      bodyTemplate: 'World',
    });
  });

  it('rejects missing templates', () => {
    expectInvalid(validateTemplateSchema, {});
  });
});

describe('previewEmailSchema', () => {
  it('accepts valid data', () => {
    expectValid(previewEmailSchema, {
      subjectTemplate: 'Subj',
      bodyTemplate: 'Body',
      leadId: 'l1',
    });
  });

  it('rejects missing leadId', () => {
    expectInvalid(previewEmailSchema, {
      subjectTemplate: 'Subj',
      bodyTemplate: 'Body',
    });
  });
});

// ---------------------------------------------------------------------------
// Lead schemas
// ---------------------------------------------------------------------------

describe('lead enum schemas', () => {
  it('leadStatusEnum accepts valid values', () => {
    for (const v of [
      'NEW', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'UNQUALIFIED',
      'CONVERTED', 'UNSUBSCRIBED', 'BOUNCED', 'ARCHIVED',
    ]) {
      expect(leadStatusEnum.parse(v)).toBe(v);
    }
    expectInvalid(leadStatusEnum, 'DELETED');
  });

  it('leadSourceEnum accepts valid values', () => {
    for (const v of ['MANUAL', 'CSV_IMPORT', 'GOOGLE_DRIVE', 'DISCOVERY', 'API', 'OTHER']) {
      expect(leadSourceEnum.parse(v)).toBe(v);
    }
    expectInvalid(leadSourceEnum, 'WEBHOOK');
  });
});

describe('linkedinUrlSchema', () => {
  it('accepts valid LinkedIn URLs', () => {
    expect(linkedinUrlSchema.parse('https://www.linkedin.com/in/johndoe')).toBeTruthy();
    expect(linkedinUrlSchema.parse('https://linkedin.com/company/acme')).toBeTruthy();
    expect(linkedinUrlSchema.parse('http://linkedin.com/in/user')).toBeTruthy();
  });

  it('rejects non-LinkedIn URLs', () => {
    expectInvalid(linkedinUrlSchema, 'https://google.com');
    expectInvalid(linkedinUrlSchema, 'https://notlinkedin.com/in/user');
  });

  it('rejects empty string', () => {
    expectInvalid(linkedinUrlSchema, '');
  });

  it('rejects short link domains', () => {
    expectInvalid(linkedinUrlSchema, 'https://lnkd.in/abc');
  });
});

describe('optionalLinkedinUrlSchema', () => {
  it('accepts empty string', () => {
    const result = optionalLinkedinUrlSchema.parse('');
    expect(result).toBe('');
  });

  it('accepts null', () => {
    const result = optionalLinkedinUrlSchema.parse(null);
    expect(result).toBeNull();
  });

  it('accepts undefined', () => {
    // optionalLinkedinUrlSchema is .optional(), so undefined is allowed
    const result = optionalLinkedinUrlSchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it('accepts valid LinkedIn URL', () => {
    const result = optionalLinkedinUrlSchema.parse('https://linkedin.com/in/user');
    expect(result).toBe('https://linkedin.com/in/user');
  });

  it('rejects non-LinkedIn URL', () => {
    expectInvalid(optionalLinkedinUrlSchema, 'https://google.com');
  });
});

describe('createLeadSchema', () => {
  const valid = { email: 'lead@example.com' };

  it('accepts minimal data', () => {
    const result = expectValid(createLeadSchema, valid);
    expect(result.email).toBe('lead@example.com');
    expect(result.firstName).toBeUndefined();
  });

  it('accepts full data', () => {
    const result = expectValid(createLeadSchema, {
      email: 'lead@example.com',
      firstName: 'John',
      lastName: 'Doe',
      fullName: 'John Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
      jobTitle: 'CEO',
      industry: 'Tech',
      phone: '+1234567890',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
      countryCode: 'US',
      country: 'United States',
      region: 'North America',
      state: 'CA',
      city: 'San Francisco',
      website: 'https://acme.com',
      status: 'NEW',
      source: 'MANUAL',
      customFields: { key1: 'value1' },
    });
    expect(result.firstName).toBe('John');
    expect(result.countryCode).toBe('US');
  });

  it('rejects invalid email', () => {
    expectInvalid(createLeadSchema, { email: 'not-email' });
  });

  it('rejects missing email', () => {
    expectInvalid(createLeadSchema, { firstName: 'John' });
  });

  it('rejects invalid countryCode length', () => {
    expectInvalid(createLeadSchema, { email: 'a@b.com', countryCode: 'USA' });
    expectInvalid(createLeadSchema, { email: 'a@b.com', countryCode: 'U' });
  });

  it('rejects invalid linkedinUrl', () => {
    expectInvalid(createLeadSchema, {
      email: 'a@b.com',
      linkedinUrl: 'https://google.com',
    });
  });

  it('accepts linkedinUrl as empty string or null', () => {
    expectValid(createLeadSchema, { email: 'a@b.com', linkedinUrl: '' });
    expectValid(createLeadSchema, { email: 'a@b.com', linkedinUrl: null });
  });
});

describe('updateLeadSchema', () => {
  it('accepts partial data', () => {
    const result = expectValid(updateLeadSchema, { firstName: 'Jane' });
    expect(result.firstName).toBe('Jane');
  });

  it('accepts empty object', () => {
    expectValid(updateLeadSchema, {});
  });

  it('rejects invalid email in partial update', () => {
    expectInvalid(updateLeadSchema, { email: 'bad' });
  });
});

describe('leadListQuerySchema', () => {
  it('applies defaults', () => {
    const result = expectValid(leadListQuerySchema, {});
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortOrder).toBe('desc');
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts valid filters', () => {
    expectValid(leadListQuerySchema, {
      status: 'NEW',
      source: 'CSV_IMPORT',
      verificationStatus: 'VERIFIED',
      enrichmentStatus: 'COMPLETED',
      prospectPriority: 'HIGH',
      minProspectScore: 50,
      sortBy: 'email',
    });
  });

  it('rejects minProspectScore out of range', () => {
    expectInvalid(leadListQuerySchema, { minProspectScore: -1 });
    expectInvalid(leadListQuerySchema, { minProspectScore: 101 });
  });
});

describe('bulkLeadActionSchema', () => {
  it('accepts valid leadIds', () => {
    expectValid(bulkLeadActionSchema, { leadIds: ['a'] });
  });

  it('rejects empty array', () => {
    expectInvalid(bulkLeadActionSchema, { leadIds: [] });
  });

  it('rejects more than 500', () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id${i}`);
    expectInvalid(bulkLeadActionSchema, { leadIds: ids });
  });
});

describe('bulkTagSchema', () => {
  it('accepts valid data', () => {
    expectValid(bulkTagSchema, { leadIds: ['l1'], tagIds: ['t1'] });
  });

  it('rejects empty tagIds', () => {
    expectInvalid(bulkTagSchema, { leadIds: ['l1'], tagIds: [] });
  });
});

describe('bulkListSchema', () => {
  it('accepts valid data', () => {
    expectValid(bulkListSchema, { leadIds: ['l1'], listId: 'list1' });
  });

  it('rejects missing listId', () => {
    expectInvalid(bulkListSchema, { leadIds: ['l1'] });
  });
});

describe('bulkStatusSchema', () => {
  it('accepts valid data', () => {
    expectValid(bulkStatusSchema, { leadIds: ['l1'], status: 'QUALIFIED' });
  });

  it('rejects invalid status', () => {
    expectInvalid(bulkStatusSchema, { leadIds: ['l1'], status: 'DELETED' });
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('createTagSchema', () => {
  it('accepts valid tag', () => {
    const result = expectValid(createTagSchema, { name: 'Important' });
    expect(result.color).toBeUndefined();
  });

  it('accepts valid hex color', () => {
    const result = expectValid(createTagSchema, { name: 'VIP', color: '#FF0000' });
    expect(result.color).toBe('#FF0000');
  });

  it('rejects empty name', () => {
    expectInvalid(createTagSchema, { name: '' });
  });

  it('rejects name over 50 chars', () => {
    expectInvalid(createTagSchema, { name: 'x'.repeat(51) });
  });

  it('rejects invalid hex color', () => {
    expectInvalid(createTagSchema, { name: 'T', color: 'red' });
    expectInvalid(createTagSchema, { name: 'T', color: '#FFF' });
    expectInvalid(createTagSchema, { name: 'T', color: '#GGGGGG' });
  });
});

describe('updateTagSchema', () => {
  it('accepts partial update', () => {
    expectValid(updateTagSchema, { name: 'NewName' });
    expectValid(updateTagSchema, { color: '#00FF00' });
    expectValid(updateTagSchema, {});
  });
});

// ---------------------------------------------------------------------------
// Lead Lists
// ---------------------------------------------------------------------------

describe('createLeadListSchema', () => {
  it('accepts valid list', () => {
    const result = expectValid(createLeadListSchema, { name: 'My List' });
    expect(result.description).toBeUndefined();
  });

  it('rejects name over 100 chars', () => {
    expectInvalid(createLeadListSchema, { name: 'x'.repeat(101) });
  });

  it('rejects description over 500 chars', () => {
    expectInvalid(createLeadListSchema, { name: 'L', description: 'x'.repeat(501) });
  });
});

describe('updateLeadListSchema', () => {
  it('accepts partial update', () => {
    expectValid(updateLeadListSchema, {});
    expectValid(updateLeadListSchema, { description: 'Updated' });
  });
});

// ---------------------------------------------------------------------------
// Lead Notes
// ---------------------------------------------------------------------------

describe('createLeadNoteSchema', () => {
  it('accepts valid note', () => {
    expectValid(createLeadNoteSchema, { content: 'Note text' });
  });

  it('rejects empty content', () => {
    expectInvalid(createLeadNoteSchema, { content: '' });
  });

  it('rejects content over 5000 chars', () => {
    expectInvalid(createLeadNoteSchema, { content: 'x'.repeat(5001) });
  });
});

// ---------------------------------------------------------------------------
// CSV Column Mapping
// ---------------------------------------------------------------------------

describe('csvColumnMappingSchema', () => {
  it('accepts valid mappings', () => {
    const result = expectValid(csvColumnMappingSchema, {
      mappings: { 'Email Address': 'email', 'First Name': 'firstName' },
    });
    expect(result.skipDuplicates).toBe(true);
  });

  it('accepts skipDuplicates=false', () => {
    const result = expectValid(csvColumnMappingSchema, {
      mappings: { col: 'field' },
      skipDuplicates: false,
    });
    expect(result.skipDuplicates).toBe(false);
  });

  it('rejects missing mappings', () => {
    expectInvalid(csvColumnMappingSchema, {});
  });
});

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

describe('createSuppressionSchema', () => {
  it('accepts valid EMAIL suppression', () => {
    const result = expectValid(createSuppressionSchema, {
      type: 'EMAIL',
      value: 'user@example.com',
    });
    expect(result.reason).toBe('MANUAL');
  });

  it('accepts valid DOMAIN suppression', () => {
    expectValid(createSuppressionSchema, {
      type: 'DOMAIN',
      value: 'example.com',
      reason: 'BOUNCED',
    });
  });

  it('rejects invalid type', () => {
    expectInvalid(createSuppressionSchema, { type: 'IP', value: '1.2.3.4' });
  });

  it('rejects empty value', () => {
    expectInvalid(createSuppressionSchema, { type: 'EMAIL', value: '' });
  });
});

describe('bulkSuppressionSchema', () => {
  it('accepts valid entries', () => {
    expectValid(bulkSuppressionSchema, {
      entries: [{ type: 'EMAIL', value: 'a@b.com' }],
    });
  });

  it('rejects empty entries', () => {
    expectInvalid(bulkSuppressionSchema, { entries: [] });
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe('verifyEmailSchema', () => {
  it('accepts valid data', () => {
    expectValid(verifyEmailSchema, { email: 'test@example.com' });
  });

  it('rejects invalid email', () => {
    expectInvalid(verifyEmailSchema, { email: 'bad' });
  });
});

describe('bulkVerifySchema', () => {
  it('accepts emails', () => {
    expectValid(bulkVerifySchema, { emails: ['a@b.com'] });
  });

  it('accepts leadIds', () => {
    expectValid(bulkVerifySchema, { leadIds: ['lead1'] });
  });

  it('rejects when neither emails nor leadIds provided', () => {
    expectInvalid(bulkVerifySchema, {});
  });

  it('rejects empty arrays for both', () => {
    expectInvalid(bulkVerifySchema, { emails: [], leadIds: [] });
  });
});

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

describe('createCustomFieldSchema', () => {
  it('accepts valid data with default fieldType', () => {
    const result = expectValid(createCustomFieldSchema, { key: 'company_size', label: 'Company Size' });
    expect(result.fieldType).toBe('TEXT');
  });

  it('rejects empty key', () => {
    expectInvalid(createCustomFieldSchema, { key: '', label: 'L' });
  });

  it('rejects empty label', () => {
    expectInvalid(createCustomFieldSchema, { key: 'k', label: '' });
  });
});

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

describe('integrationProviderEnum', () => {
  it('accepts GOOGLE_DRIVE', () => {
    expect(integrationProviderEnum.parse('GOOGLE_DRIVE')).toBe('GOOGLE_DRIVE');
  });

  it('rejects unknown provider', () => {
    expectInvalid(integrationProviderEnum, 'DROPBOX');
  });
});

describe('connectIntegrationSchema', () => {
  it('accepts valid provider', () => {
    expectValid(connectIntegrationSchema, { provider: 'GOOGLE_DRIVE' });
  });
});

describe('oauthCallbackSchema', () => {
  it('accepts valid data', () => {
    expectValid(oauthCallbackSchema, { code: 'abc', state: 'xyz' });
  });

  it('rejects empty code', () => {
    expectInvalid(oauthCallbackSchema, { code: '', state: 'xyz' });
  });

  it('rejects empty state', () => {
    expectInvalid(oauthCallbackSchema, { code: 'abc', state: '' });
  });
});

// ---------------------------------------------------------------------------
// Drive Import
// ---------------------------------------------------------------------------

describe('driveImportSchema', () => {
  const valid = {
    integrationId: 'int1',
    files: [{ fileId: 'f1', fileName: 'leads.csv', mimeType: 'text/csv' }],
    mappings: { email: 'email' },
    options: {},
  };

  it('accepts valid data', () => {
    const result = expectValid(driveImportSchema, valid);
    expect(result.options.skipDuplicates).toBe(true);
  });

  it('rejects empty files array', () => {
    expectInvalid(driveImportSchema, { ...valid, files: [] });
  });

  it('rejects more than 20 files', () => {
    const files = Array.from({ length: 21 }, (_, i) => ({
      fileId: `f${i}`,
      fileName: `file${i}.csv`,
      mimeType: 'text/csv',
    }));
    expectInvalid(driveImportSchema, { ...valid, files });
  });
});

// ---------------------------------------------------------------------------
// Website Intelligence
// ---------------------------------------------------------------------------

describe('analyzeWebsiteSchema', () => {
  it('accepts valid data', () => {
    expectValid(analyzeWebsiteSchema, { leadId: 'lead1' });
  });

  it('rejects empty leadId', () => {
    expectInvalid(analyzeWebsiteSchema, { leadId: '' });
  });

  it('rejects customPrompt over 4000 chars', () => {
    expectInvalid(analyzeWebsiteSchema, { leadId: 'l1', customPrompt: 'x'.repeat(4001) });
  });
});

describe('batchAnalyzeSchema', () => {
  it('accepts valid leadIds', () => {
    expectValid(batchAnalyzeSchema, { leadIds: ['l1', 'l2'] });
  });

  it('rejects empty leadIds', () => {
    expectInvalid(batchAnalyzeSchema, { leadIds: [] });
  });

  it('rejects more than 100 leadIds', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `l${i}`);
    expectInvalid(batchAnalyzeSchema, { leadIds: ids });
  });
});

// ---------------------------------------------------------------------------
// Lead Enrichment
// ---------------------------------------------------------------------------

describe('enrichLeadSchema', () => {
  it('accepts valid data', () => {
    expectValid(enrichLeadSchema, { leadId: 'l1' });
  });

  it('rejects empty leadId', () => {
    expectInvalid(enrichLeadSchema, { leadId: '' });
  });
});

describe('batchEnrichSchema', () => {
  it('accepts valid leadIds', () => {
    expectValid(batchEnrichSchema, { leadIds: ['l1'] });
  });

  it('rejects empty', () => {
    expectInvalid(batchEnrichSchema, { leadIds: [] });
  });

  it('rejects more than 500', () => {
    const ids = Array.from({ length: 501 }, (_, i) => `l${i}`);
    expectInvalid(batchEnrichSchema, { leadIds: ids });
  });
});

describe('icpProfileSchema', () => {
  it('accepts empty object with defaults', () => {
    const result = expectValid(icpProfileSchema, {});
    expect(result.targetIndustries).toEqual([]);
    expect(result.requireVerifiedEmail).toBe(false);
    expect(result.weights.industry).toBe(25);
    expect(result.weights.location).toBe(15);
    expect(result.weights.companySize).toBe(15);
    expect(result.weights.jobTitle).toBe(25);
    expect(result.weights.seniority).toBe(20);
  });

  it('rejects weights that do not sum to 100', () => {
    expectInvalid(icpProfileSchema, {
      weights: {
        industry: 50,
        location: 50,
        companySize: 50,
        jobTitle: 50,
        seniority: 50,
      },
    });
  });

  it('accepts custom weights summing to 100', () => {
    const result = expectValid(icpProfileSchema, {
      weights: {
        industry: 40,
        location: 10,
        companySize: 10,
        jobTitle: 30,
        seniority: 10,
      },
    });
    expect(result.weights.industry).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Warmup
// ---------------------------------------------------------------------------

describe('warmupSettingsSchema', () => {
  it('accepts empty object', () => {
    expectValid(warmupSettingsSchema, {});
  });

  it('accepts valid settings', () => {
    expectValid(warmupSettingsSchema, {
      startingDailyLimit: 10,
      maximumDailyLimit: 100,
      rampStep: 5,
      rampIntervalHours: 24,
      timezone: 'America/New_York',
      weekdays: [1, 2, 3, 4, 5],
      windowStart: '08:00',
      windowEnd: '18:00',
      consecutiveFailureThreshold: 5,
    });
  });

  it('rejects invalid weekday', () => {
    expectInvalid(warmupSettingsSchema, { weekdays: [7] });
  });

  it('rejects empty weekdays', () => {
    expectInvalid(warmupSettingsSchema, { weekdays: [] });
  });

  it('rejects too many weekdays', () => {
    expectInvalid(warmupSettingsSchema, { weekdays: [0, 1, 2, 3, 4, 5, 6, 0] });
  });

  it('rejects invalid time format', () => {
    expectInvalid(warmupSettingsSchema, { windowStart: '8am' });
  });

  it('rejects out of range values', () => {
    expectInvalid(warmupSettingsSchema, { startingDailyLimit: 0 });
    expectInvalid(warmupSettingsSchema, { startingDailyLimit: 201 });
    expectInvalid(warmupSettingsSchema, { maximumDailyLimit: 2001 });
    expectInvalid(warmupSettingsSchema, { rampStep: 0 });
    expectInvalid(warmupSettingsSchema, { consecutiveFailureThreshold: 0 });
    expectInvalid(warmupSettingsSchema, { consecutiveFailureThreshold: 21 });
  });
});

describe('warmupResetSchema', () => {
  it('accepts confirm=true', () => {
    expectValid(warmupResetSchema, { confirm: true });
  });

  it('rejects confirm=false', () => {
    expectInvalid(warmupResetSchema, { confirm: false });
  });
});

describe('createWarmupRecipientSchema', () => {
  it('accepts valid data', () => {
    expectValid(createWarmupRecipientSchema, {
      email: 'a@b.com',
      consentConfirmed: true,
    });
  });

  it('rejects consentConfirmed=false', () => {
    expectInvalid(createWarmupRecipientSchema, {
      email: 'a@b.com',
      consentConfirmed: false,
    });
  });

  it('rejects invalid email', () => {
    expectInvalid(createWarmupRecipientSchema, {
      email: 'bad',
      consentConfirmed: true,
    });
  });
});

describe('updateWarmupRecipientSchema', () => {
  it('accepts at least one field', () => {
    expectValid(updateWarmupRecipientSchema, { enabled: true });
    expectValid(updateWarmupRecipientSchema, { name: 'Test' });
    expectValid(updateWarmupRecipientSchema, { consentConfirmed: true });
  });

  it('rejects empty object (no fields)', () => {
    expectInvalid(updateWarmupRecipientSchema, {});
  });
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

describe('sendInboxReplySchema', () => {
  it('accepts valid reply', () => {
    expectValid(sendInboxReplySchema, {
      subject: 'Re: Hello',
      body: 'Thanks!',
    });
  });

  it('rejects empty subject', () => {
    expectInvalid(sendInboxReplySchema, { subject: '', body: 'text' });
  });

  it('rejects empty body', () => {
    expectInvalid(sendInboxReplySchema, { subject: 'Re', body: '' });
  });

  it('rejects subject over 500 chars', () => {
    expectInvalid(sendInboxReplySchema, { subject: 'x'.repeat(501), body: 'text' });
  });

  it('rejects body over 50000 chars', () => {
    expectInvalid(sendInboxReplySchema, { subject: 'Re', body: 'x'.repeat(50001) });
  });
});

describe('updateConversationSchema', () => {
  it('accepts status update', () => {
    expectValid(updateConversationSchema, { status: 'CLOSED' });
  });

  it('accepts classification update', () => {
    expectValid(updateConversationSchema, { classification: 'INTERESTED' });
  });

  it('accepts assignedUserId update', () => {
    expectValid(updateConversationSchema, { assignedUserId: 'u1' });
  });

  it('accepts null assignedUserId', () => {
    expectValid(updateConversationSchema, { assignedUserId: null });
  });

  it('rejects empty object (no fields)', () => {
    expectInvalid(updateConversationSchema, {});
  });
});

describe('createConversationNoteSchema', () => {
  it('accepts valid note', () => {
    expectValid(createConversationNoteSchema, { content: 'Note' });
  });

  it('rejects empty content', () => {
    expectInvalid(createConversationNoteSchema, { content: '' });
  });

  it('rejects content over 5000 chars', () => {
    expectInvalid(createConversationNoteSchema, { content: 'x'.repeat(5001) });
  });
});

describe('testImapConnectionSchema', () => {
  it('accepts valid data', () => {
    const result = expectValid(testImapConnectionSchema, {
      imapHost: 'imap.example.com',
      imapPort: 993,
      password: 'secret',
    });
    expect(result.encryptionType).toBe('TLS');
  });

  it('rejects missing password', () => {
    expectInvalid(testImapConnectionSchema, {
      imapHost: 'imap.example.com',
      imapPort: 993,
    });
  });

  it('rejects port out of range', () => {
    expectInvalid(testImapConnectionSchema, {
      imapHost: 'imap.example.com',
      imapPort: 0,
      password: 'x',
    });
    expectInvalid(testImapConnectionSchema, {
      imapHost: 'imap.example.com',
      imapPort: 70000,
      password: 'x',
    });
  });
});

// ---------------------------------------------------------------------------
// Deliverability
// ---------------------------------------------------------------------------

describe('deliverabilityPeriodSchema', () => {
  it('accepts valid periods', () => {
    for (const v of ['today', '7d', '30d']) {
      expect(deliverabilityPeriodSchema.parse(v)).toBe(v);
    }
  });

  it('rejects invalid period', () => {
    expectInvalid(deliverabilityPeriodSchema, '90d');
  });
});

describe('checkDomainHealthSchema', () => {
  it('applies default force=false', () => {
    const result = expectValid(checkDomainHealthSchema, {});
    expect(result.force).toBe(false);
  });

  it('accepts dkimSelector', () => {
    expectValid(checkDomainHealthSchema, { dkimSelector: 'google' });
  });

  it('rejects dkimSelector over 100 chars', () => {
    expectInvalid(checkDomainHealthSchema, { dkimSelector: 'x'.repeat(101) });
  });
});

describe('updateDeliverabilityPolicySchema', () => {
  it('accepts protection only', () => {
    expectValid(updateDeliverabilityPolicySchema, {
      protection: { pauseOnCriticalBounceRate: true },
    });
  });

  it('accepts thresholds only', () => {
    expectValid(updateDeliverabilityPolicySchema, {
      thresholds: { excellent: 95 },
    });
  });

  it('rejects when neither provided', () => {
    expectInvalid(updateDeliverabilityPolicySchema, {});
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('analyticsPeriodSchema', () => {
  it('accepts valid periods', () => {
    for (const v of ['today', 'yesterday', '7d', '30d', '90d', 'custom']) {
      expect(analyticsPeriodSchema.parse(v)).toBe(v);
    }
  });
});

describe('analyticsRangeQuerySchema', () => {
  it('applies default period', () => {
    const result = expectValid(analyticsRangeQuerySchema, {});
    expect(result.period).toBe('7d');
  });

  it('accepts custom period with dates', () => {
    expectValid(analyticsRangeQuerySchema, {
      period: 'custom',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });
  });
});

describe('recordLeadOutcomeSchema', () => {
  it('accepts valid outcome', () => {
    expectValid(recordLeadOutcomeSchema, {
      leadId: 'l1',
      type: 'MEETING_BOOKED',
    });
  });

  it('rejects invalid type', () => {
    expectInvalid(recordLeadOutcomeSchema, {
      leadId: 'l1',
      type: 'WON',
    });
  });

  it('rejects missing leadId', () => {
    expectInvalid(recordLeadOutcomeSchema, { type: 'CONVERTED' });
  });
});

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

describe('createWorkflowSchema', () => {
  it('accepts valid data', () => {
    expectValid(createWorkflowSchema, { name: 'My Workflow' });
  });

  it('rejects empty name', () => {
    expectInvalid(createWorkflowSchema, { name: '' });
  });

  it('rejects name over 200 chars', () => {
    expectInvalid(createWorkflowSchema, { name: 'x'.repeat(201) });
  });

  it('rejects description over 2000 chars', () => {
    expectInvalid(createWorkflowSchema, { name: 'W', description: 'x'.repeat(2001) });
  });
});

describe('updateWorkflowSchema', () => {
  it('accepts partial update', () => {
    expectValid(updateWorkflowSchema, { name: 'Updated' });
    expectValid(updateWorkflowSchema, { nodes: [{ type: 'trigger' }] });
    expectValid(updateWorkflowSchema, {});
  });
});

describe('workflowListQuerySchema', () => {
  it('accepts valid status', () => {
    expectValid(workflowListQuerySchema, { status: 'ACTIVE' });
  });

  it('accepts empty query', () => {
    expectValid(workflowListQuerySchema, {});
  });

  it('rejects invalid status', () => {
    expectInvalid(workflowListQuerySchema, { status: 'RUNNING' });
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('discoverySearchSchema', () => {
  it('applies defaults', () => {
    const result = expectValid(discoverySearchSchema, {});
    expect(result.maxResults).toBe(50);
    expect(result.requireWebsite).toBe(false);
    expect(result.requirePhone).toBe(false);
    expect(result.requireEmail).toBe(false);
    expect(result.minScore).toBe(0);
  });

  it('accepts full search config', () => {
    expectValid(discoverySearchSchema, {
      country: 'US',
      countryCode: 'US',
      state: 'CA',
      city: 'San Francisco',
      industry: 'Tech',
      category: 'Software',
      keywords: ['SaaS'],
      radiusMeters: 5000,
      maxResults: 100,
      requireWebsite: true,
    });
  });

  it('rejects keywords over 10', () => {
    const keywords = Array.from({ length: 11 }, (_, i) => `kw${i}`);
    expectInvalid(discoverySearchSchema, { keywords });
  });

  it('rejects maxResults over 500', () => {
    expectInvalid(discoverySearchSchema, { maxResults: 501 });
  });

  it('rejects radiusMeters out of range', () => {
    expectInvalid(discoverySearchSchema, { radiusMeters: 50 });
    expectInvalid(discoverySearchSchema, { radiusMeters: 50001 });
  });
});

describe('createDiscoveryJobSchema', () => {
  it('accepts valid data', () => {
    expectValid(createDiscoveryJobSchema, {
      source: 'GOOGLE_PLACES',
      query: { maxResults: 20 },
    });
  });

  it('rejects invalid source', () => {
    expectInvalid(createDiscoveryJobSchema, {
      source: 'INVALID',
      query: {},
    });
  });
});

describe('saveDiscoveredLeadsSchema', () => {
  it('accepts valid ids', () => {
    expectValid(saveDiscoveredLeadsSchema, { discoveredLeadIds: ['d1'] });
  });

  it('rejects empty', () => {
    expectInvalid(saveDiscoveredLeadsSchema, { discoveredLeadIds: [] });
  });

  it('rejects more than 500', () => {
    const ids = Array.from({ length: 501 }, (_, i) => `d${i}`);
    expectInvalid(saveDiscoveredLeadsSchema, { discoveredLeadIds: ids });
  });
});

describe('enrollDiscoveredLeadsSchema', () => {
  it('accepts valid data with default', () => {
    const result = expectValid(enrollDiscoveredLeadsSchema, {
      discoveredLeadIds: ['d1'],
      campaignId: 'c1',
    });
    expect(result.force).toBe(false);
  });

  it('rejects empty discoveredLeadIds', () => {
    expectInvalid(enrollDiscoveredLeadsSchema, {
      discoveredLeadIds: [],
      campaignId: 'c1',
    });
  });

  it('rejects missing campaignId', () => {
    expectInvalid(enrollDiscoveredLeadsSchema, {
      discoveredLeadIds: ['d1'],
    });
  });
});

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

describe('researchLeadSchema', () => {
  it('accepts valid data with companyUrl', () => {
    expectValid(researchLeadSchema, {
      leadId: 'l1',
      companyUrl: 'https://linkedin.com/company/acme',
    });
  });

  it('accepts valid data with personUrl', () => {
    expectValid(researchLeadSchema, {
      leadId: 'l1',
      personUrl: 'https://linkedin.com/in/johndoe',
    });
  });

  it('rejects when neither companyUrl nor personUrl provided', () => {
    expectInvalid(researchLeadSchema, { leadId: 'l1' });
  });

  it('rejects non-LinkedIn companyUrl', () => {
    expectInvalid(researchLeadSchema, {
      leadId: 'l1',
      companyUrl: 'https://google.com/company/acme',
    });
  });

  it('applies forceRefresh default', () => {
    const result = expectValid(researchLeadSchema, {
      leadId: 'l1',
      companyUrl: 'https://linkedin.com/company/x',
    });
    expect(result.forceRefresh).toBe(false);
  });
});

describe('approveResearchSchema', () => {
  it('accepts researchIds', () => {
    expectValid(approveResearchSchema, { researchIds: ['r1'] });
  });

  it('accepts leadIds', () => {
    expectValid(approveResearchSchema, { leadIds: ['l1'] });
  });

  it('rejects when neither provided', () => {
    expectInvalid(approveResearchSchema, {});
  });

  it('rejects when both are empty', () => {
    expectInvalid(approveResearchSchema, { researchIds: [], leadIds: [] });
  });
});

describe('manualVerificationSchema', () => {
  it('accepts person verification', () => {
    expectValid(manualVerificationSchema, {
      person: { firstName: 'John', lastName: 'Doe' },
    });
  });

  it('accepts company verification', () => {
    expectValid(manualVerificationSchema, {
      company: { name: 'Acme', industry: 'Tech' },
    });
  });

  it('accepts signals verification', () => {
    expectValid(manualVerificationSchema, {
      signals: { decisionMaker: true, hiring: false },
    });
  });

  it('rejects when no verified fields provided', () => {
    expectInvalid(manualVerificationSchema, {});
    expectInvalid(manualVerificationSchema, { notes: 'Just a note' });
  });

  it('accepts notes with verified fields', () => {
    const result = expectValid(manualVerificationSchema, {
      person: { firstName: 'Jane' },
      notes: 'Checked LinkedIn profile',
    });
    expect(result.notes).toBe('Checked LinkedIn profile');
  });

  it('rejects notes over 2000 chars', () => {
    expectInvalid(manualVerificationSchema, {
      person: { firstName: 'Jane' },
      notes: 'x'.repeat(2001),
    });
  });
});

// ---------------------------------------------------------------------------
// Stage 15 schemas
// ---------------------------------------------------------------------------

describe('csvImportSchema', () => {
  const valid = {
    rows: [{ email: 'a@b.com', name: 'Alice' }],
    mappings: { email: 'email', name: 'firstName' },
  };

  it('accepts valid data with defaults', () => {
    const result = expectValid(csvImportSchema, valid);
    expect(result.skipDuplicates).toBe(true);
    expect(result.verifyOnImport).toBe(false);
  });

  it('accepts custom options', () => {
    const result = expectValid(csvImportSchema, {
      ...valid,
      skipDuplicates: false,
      verifyOnImport: true,
    });
    expect(result.skipDuplicates).toBe(false);
    expect(result.verifyOnImport).toBe(true);
  });

  it('rejects empty rows', () => {
    expectInvalid(csvImportSchema, { ...valid, rows: [] });
  });

  it('rejects more than 10000 rows', () => {
    const rows = Array.from({ length: 10001 }, (_, i) => ({ email: `a${i}@b.com` }));
    expectInvalid(csvImportSchema, { ...valid, rows });
  });

  it('rejects missing mappings', () => {
    expectInvalid(csvImportSchema, { rows: [{ email: 'a@b.com' }] });
  });
});

describe('leadTagAssignmentSchema', () => {
  it('accepts valid tagIds', () => {
    const result = expectValid(leadTagAssignmentSchema, { tagIds: ['t1', 't2'] });
    expect(result.tagIds).toHaveLength(2);
  });

  it('rejects empty tagIds', () => {
    expectInvalid(leadTagAssignmentSchema, { tagIds: [] });
  });

  it('rejects more than 100 tagIds', () => {
    const tagIds = Array.from({ length: 101 }, (_, i) => `t${i}`);
    expectInvalid(leadTagAssignmentSchema, { tagIds });
  });

  it('rejects tagIds with empty strings', () => {
    expectInvalid(leadTagAssignmentSchema, { tagIds: [''] });
  });
});

describe('listMemberAddSchema', () => {
  it('accepts valid leadIds', () => {
    const result = expectValid(listMemberAddSchema, { leadIds: ['l1', 'l2'] });
    expect(result.leadIds).toHaveLength(2);
  });

  it('rejects empty leadIds', () => {
    expectInvalid(listMemberAddSchema, { leadIds: [] });
  });

  it('rejects more than 500 leadIds', () => {
    const leadIds = Array.from({ length: 501 }, (_, i) => `l${i}`);
    expectInvalid(listMemberAddSchema, { leadIds });
  });

  it('rejects leadIds with empty strings', () => {
    expectInvalid(listMemberAddSchema, { leadIds: [''] });
  });
});

describe('webResearchRequestSchema', () => {
  it('accepts minimal data with defaults', () => {
    const result = expectValid(webResearchRequestSchema, { leadId: 'l1' });
    expect(result.forceRefresh).toBe(false);
    expect(result.websiteUrl).toBeUndefined();
  });

  it('accepts full data', () => {
    const result = expectValid(webResearchRequestSchema, {
      leadId: 'l1',
      websiteUrl: 'https://example.com',
      forceRefresh: true,
    });
    expect(result.websiteUrl).toBe('https://example.com');
    expect(result.forceRefresh).toBe(true);
  });

  it('rejects empty leadId', () => {
    expectInvalid(webResearchRequestSchema, { leadId: '' });
  });

  it('rejects invalid websiteUrl', () => {
    expectInvalid(webResearchRequestSchema, { leadId: 'l1', websiteUrl: 'not-a-url' });
  });
});

describe('suppressionListQuerySchema', () => {
  it('applies defaults', () => {
    const result = expectValid(suppressionListQuerySchema, {});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.type).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  it('accepts valid filters', () => {
    const result = expectValid(suppressionListQuerySchema, {
      type: 'EMAIL',
      reason: 'BOUNCED',
      page: '2',
      limit: '100',
    });
    expect(result.type).toBe('EMAIL');
    expect(result.reason).toBe('BOUNCED');
    expect(result.page).toBe(2);
    expect(result.limit).toBe(100);
  });

  it('accepts DOMAIN type', () => {
    expectValid(suppressionListQuerySchema, { type: 'DOMAIN' });
  });

  it('accepts all valid reasons', () => {
    for (const reason of ['MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'SPAM_COMPLAINT', 'INVALID', 'RISKY']) {
      expectValid(suppressionListQuerySchema, { reason });
    }
  });

  it('rejects invalid type', () => {
    expectInvalid(suppressionListQuerySchema, { type: 'IP' });
  });

  it('rejects invalid reason', () => {
    expectInvalid(suppressionListQuerySchema, { reason: 'UNKNOWN' });
  });

  it('rejects limit over 200', () => {
    expectInvalid(suppressionListQuerySchema, { limit: 201 });
  });

  it('rejects non-positive page', () => {
    expectInvalid(suppressionListQuerySchema, { page: 0 });
  });
});
