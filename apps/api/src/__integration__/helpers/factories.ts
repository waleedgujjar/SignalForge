import { randomUUID } from 'node:crypto';
import {
  stores,
  type MockLead,
  type MockCampaign,
  type MockCampaignStep,
  type MockCampaignLead,
  type MockMailbox,
  type MockSuppression,
  type MockTag,
  type MockLeadList,
  type MockDiscoveryJob,
  type MockWebsiteAnalysis,
  type MockWorkflow,
  type MockWorkflowVersion,
  type MockWorkflowEvent,
  type MockLeadNote,
  type MockDiscoveredLead,
} from './mock-db.js';

function uid(): string {
  return randomUUID();
}

export function makeLead(workspaceId: string, overrides?: Partial<MockLead>): MockLead {
  const now = new Date();
  const lead: MockLead = {
    id: uid(),
    workspaceId,
    email: `lead-${uid().slice(0, 8)}@example.com`,
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    company: 'Acme Inc',
    title: 'CEO',
    phone: null,
    website: null,
    industry: null,
    city: null,
    state: null,
    country: null,
    countryCode: null,
    linkedInUrl: null,
    source: 'manual',
    status: 'NEW',
    icpScore: null,
    qualificationReasons: null,
    notes: null,
    customFields: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  stores.leads.set(lead.id, lead);
  return lead;
}

export function makeCampaign(workspaceId: string, overrides?: Partial<MockCampaign>): MockCampaign {
  const now = new Date();
  const campaign: MockCampaign = {
    id: uid(),
    workspaceId,
    name: 'Test Campaign',
    status: 'DRAFT',
    dailySendingLimit: null,
    scheduleConfig: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  stores.campaigns.set(campaign.id, campaign);
  return campaign;
}

export function makeCampaignStep(
  campaignId: string,
  overrides?: Partial<MockCampaignStep>,
): MockCampaignStep {
  const step: MockCampaignStep = {
    id: uid(),
    campaignId,
    order: 1,
    type: 'EMAIL',
    subject: 'Hello {{firstName}}',
    body: '<p>Hi {{firstName}}, I wanted to reach out.</p>',
    delayDays: 0,
    createdAt: new Date(),
    ...overrides,
  };
  stores.campaignSteps.set(step.id, step);
  return step;
}

export function makeCampaignLead(
  campaignId: string,
  leadId: string,
  overrides?: Partial<MockCampaignLead>,
): MockCampaignLead {
  const cl: MockCampaignLead = {
    id: uid(),
    campaignId,
    leadId,
    status: 'ACTIVE',
    currentStepOrder: 1,
    stopReason: null,
    enrolledAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
  stores.campaignLeads.set(cl.id, cl);
  return cl;
}

export function makeMailbox(workspaceId: string, overrides?: Partial<MockMailbox>): MockMailbox {
  const mailbox: MockMailbox = {
    id: uid(),
    workspaceId,
    email: `mailbox-${uid().slice(0, 8)}@test.signalforge`,
    name: 'Test Mailbox',
    provider: 'smtp',
    smtpHost: 'smtp.test.local',
    smtpPort: 587,
    smtpUser: 'test',
    encryptedPassword: 'encrypted-test',
    isActive: true,
    dailySendLimit: 50,
    warmupEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  stores.mailboxes.set(mailbox.id, mailbox);
  return mailbox;
}

export function makeSuppression(
  workspaceId: string,
  overrides?: Partial<MockSuppression>,
): MockSuppression {
  const suppression: MockSuppression = {
    id: uid(),
    workspaceId,
    type: 'EMAIL',
    value: `suppressed-${uid().slice(0, 8)}@example.com`,
    reason: null,
    createdAt: new Date(),
    ...overrides,
  };
  stores.suppressions.set(suppression.id, suppression);
  return suppression;
}

export function makeTag(workspaceId: string, overrides?: Partial<MockTag>): MockTag {
  const tag: MockTag = {
    id: uid(),
    workspaceId,
    name: `tag-${uid().slice(0, 8)}`,
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  stores.tags.set(tag.id, tag);
  return tag;
}

export function makeList(workspaceId: string, overrides?: Partial<MockLeadList>): MockLeadList {
  const list: MockLeadList = {
    id: uid(),
    workspaceId,
    name: `list-${uid().slice(0, 8)}`,
    description: null,
    createdAt: new Date(),
    ...overrides,
  };
  stores.leadLists.set(list.id, list);
  return list;
}

export function makeDiscoveryJob(
  workspaceId: string,
  overrides?: Partial<MockDiscoveryJob>,
): MockDiscoveryJob {
  const now = new Date();
  const job: MockDiscoveryJob = {
    id: uid(),
    workspaceId,
    source: 'google-maps',
    status: 'PENDING',
    query: { keywords: 'test' },
    filters: null,
    totalFound: 0,
    totalQualified: 0,
    totalSaved: 0,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  stores.discoveryJobs.set(job.id, job);
  return job;
}

export function makeDiscoveredLead(
  jobId: string,
  workspaceId: string,
  overrides?: Partial<MockDiscoveredLead>,
): MockDiscoveredLead {
  const lead: MockDiscoveredLead = {
    id: uid(),
    jobId,
    workspaceId,
    source: 'google-maps',
    sourceId: `gm-${uid().slice(0, 8)}`,
    stage: 'QUALIFIED',
    company: 'Discovered Co',
    email: null,
    phone: null,
    website: null,
    data: {},
    icpScore: null,
    promotedLeadId: null,
    createdAt: new Date(),
    ...overrides,
  };
  stores.discoveredLeads.set(lead.id, lead);
  return lead;
}

export function makeWorkflow(
  workspaceId: string,
  overrides?: Partial<MockWorkflow>,
): MockWorkflow {
  const now = new Date();
  const workflow: MockWorkflow = {
    id: uid(),
    workspaceId,
    name: 'Test Workflow',
    status: 'DRAFT',
    publishedVersionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  stores.workflows.set(workflow.id, workflow);
  return workflow;
}

export function makeWorkflowVersion(
  workflowId: string,
  overrides?: Partial<MockWorkflowVersion>,
): MockWorkflowVersion {
  const version: MockWorkflowVersion = {
    id: uid(),
    workflowId,
    version: 1,
    nodes: [],
    edges: [],
    createdAt: new Date(),
    ...overrides,
  };
  stores.workflowVersions.set(version.id, version);
  return version;
}

export function makeWorkflowEvent(
  workspaceId: string,
  overrides?: Partial<MockWorkflowEvent>,
): MockWorkflowEvent {
  const event: MockWorkflowEvent = {
    id: uid(),
    workspaceId,
    eventType: 'LEAD_CREATED',
    leadId: null,
    campaignId: null,
    mailboxId: null,
    conversationId: null,
    idempotencyKey: uid(),
    payload: null,
    createdAt: new Date(),
    ...overrides,
  };
  stores.workflowEvents.set(event.id, event);
  return event;
}

export function makeWebsiteAnalysis(
  workspaceId: string,
  overrides?: Partial<MockWebsiteAnalysis>,
): MockWebsiteAnalysis {
  const now = new Date();
  const analysis: MockWebsiteAnalysis = {
    id: uid(),
    workspaceId,
    leadId: null,
    url: 'https://example.com',
    status: 'PENDING',
    websiteScore: null,
    opportunityScore: null,
    opportunityPriority: null,
    findings: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  stores.websiteAnalyses.set(analysis.id, analysis);
  return analysis;
}

export function makeLeadNote(
  leadId: string,
  workspaceId: string,
  authorId: string,
  overrides?: Partial<MockLeadNote>,
): MockLeadNote {
  const note: MockLeadNote = {
    id: uid(),
    leadId,
    workspaceId,
    content: 'Test note',
    authorId,
    createdAt: new Date(),
    ...overrides,
  };
  stores.leadNotes.set(note.id, note);
  return note;
}
