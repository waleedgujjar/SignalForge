import { vi } from 'vitest';

const enqueuedJobs = new Map<string, unknown[]>();

export function getEnqueuedJobs(queueName: string): unknown[] {
  return enqueuedJobs.get(queueName) ?? [];
}

export function clearEnqueuedJobs(): void {
  enqueuedJobs.clear();
}

export function assertJobEnqueued(queueName: string, matcher: Record<string, unknown>): void {
  const jobs = getEnqueuedJobs(queueName);
  const found = jobs.some((job) => {
    const j = job as Record<string, unknown>;
    return Object.entries(matcher).every(([k, v]) => j[k] === v);
  });
  if (!found) {
    throw new Error(
      `Expected a job matching ${JSON.stringify(matcher)} on queue "${queueName}", found: ${JSON.stringify(jobs)}`,
    );
  }
}

function recordEnqueue(queueName: string, payload: unknown): void {
  if (!enqueuedJobs.has(queueName)) enqueuedJobs.set(queueName, []);
  enqueuedJobs.get(queueName)!.push(payload);
}

export function buildQueueMock() {
  return {
    QUEUE_NAMES: {
      LEAD_DISCOVERY: 'lead-discovery',
      CAMPAIGN_ENROLLMENT: 'campaign-enrollment',
      EMAIL_SEND: 'email-send',
      EMAIL_VERIFICATION: 'email-verification',
      WEBSITE_ANALYSIS: 'website-analysis',
      LEAD_ENRICHMENT: 'lead-enrichment',
      LEAD_RESEARCH: 'lead-research',
      WORKFLOW: 'workflow',
      WARMUP: 'warmup',
      INBOX_REPLY: 'inbox-reply',
      EMAIL_INBOUND: 'email-inbound',
      DELIVERABILITY_AGGREGATION: 'deliverability-aggregation',
      DOMAIN_HEALTH_CHECK: 'domain-health-check',
      ANALYTICS: 'analytics',
    },
    enqueueLeadDiscovery: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('lead-discovery', payload);
    }),
    enqueueCampaignEnrollment: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('campaign-enrollment', payload);
    }),
    enqueueEmailSend: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('email-send', payload);
    }),
    enqueueEmailVerification: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('email-verification', payload);
    }),
    enqueueWebsiteAnalysis: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('website-analysis', payload);
    }),
    enqueueLeadEnrichment: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('lead-enrichment', payload);
    }),
    enqueueLeadResearch: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('lead-research', payload);
    }),
    enqueueWorkflowEvent: vi.fn(async (_q: unknown, payload: unknown) => {
      recordEnqueue('workflow', payload);
    }),
    BULK_ENROLLMENT_THRESHOLD: 100,
    WEBSITE_ANALYSIS_JOB_OPTIONS: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    checkRedisConnection: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    createQueue: vi.fn(() => ({
      getJobCounts: vi.fn(async () => ({})),
      close: vi.fn(),
      add: vi.fn(),
    })),
    createRedisConnection: vi.fn(),
    createWorker: vi.fn(),
    registerWorkerShutdown: vi.fn(() => vi.fn()),
  };
}
