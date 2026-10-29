export const QUEUE_NAMES = {
  EMAIL_SEND: 'email-send',
  EMAIL_RETRY: 'email-retry',
  EMAIL_INBOUND: 'email-inbound',
  INBOX_REPLY: 'inbox-reply',
  WARMUP: 'warmup',
  LEAD_PROCESSING: 'lead-processing',
  LEAD_ENRICHMENT: 'lead-enrichment',
  AI: 'ai',
  ANALYTICS: 'analytics',
  NOTIFICATIONS: 'notifications',
  HEALTH: 'health',
  LEAD_IMPORT: 'lead-import',
  WEBSITE_ANALYSIS: 'website-analysis',
  SCHEDULER_TICK: 'scheduler-tick',
  DELIVERABILITY_AGGREGATION: 'deliverability-aggregation',
  DOMAIN_HEALTH_CHECK: 'domain-health-check',
  WORKFLOW: 'workflow',
  LEAD_DISCOVERY: 'lead-discovery',
  EMAIL_VERIFICATION: 'email-verification',
  LEAD_RESEARCH: 'lead-research',
  CAMPAIGN_ENROLLMENT: 'campaign-enrollment',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export { createRedisConnection, checkRedisConnection } from './redis.js';
export { createQueue, createWorker, withJobTimeout, DEFAULT_JOB_OPTIONS, ENRICHMENT_JOB_OPTIONS, WEBSITE_ANALYSIS_JOB_OPTIONS, type CreateWorkerOpts } from './bullmq.js';
export {
  enqueueEmailSend,
  enqueueEmailRetry,
  EMAIL_SEND_JOB_OPTIONS,
  type EmailSendQueuePayload,
} from './email-send.js';
export {
  enqueueWarmupSend,
  WARMUP_JOB_OPTIONS,
  type WarmupQueuePayload,
} from './warmup-send.js';
export {
  enqueueInboundSync,
  INBOUND_SYNC_JOB_OPTIONS,
  type InboundSyncQueuePayload,
} from './inbound-sync.js';
export {
  enqueueInboxReply,
  INBOX_REPLY_JOB_OPTIONS,
  type InboxReplyQueuePayload,
} from './inbox-reply.js';
export {
  enqueueDeliverabilityAggregation,
  enqueueDomainHealthCheck,
  DELIVERABILITY_AGGREGATION_JOB_OPTIONS,
  DOMAIN_HEALTH_CHECK_JOB_OPTIONS,
  type DeliverabilityAggregationPayload,
  type DomainHealthCheckPayload,
} from './deliverability.js';
export {
  enqueueAnalyticsAggregation,
  ANALYTICS_AGGREGATION_JOB_OPTIONS,
  type AnalyticsAggregationPayload,
} from './analytics.js';
export {
  enqueueWorkflowEvent,
  enqueueWorkflowStep,
  WORKFLOW_JOB_OPTIONS,
  type WorkflowEventQueuePayload,
  type WorkflowStepQueuePayload,
  type WorkflowQueuePayload,
} from './workflow.js';
export {
  enqueueLeadDiscovery,
  enqueueRequalification,
  LEAD_DISCOVERY_JOB_OPTIONS,
  type LeadDiscoveryQueuePayload,
  type RequalifyQueuePayload,
} from './lead-discovery.js';
export {
  enqueueEmailVerification,
  EMAIL_VERIFICATION_JOB_OPTIONS,
  type EmailVerificationQueuePayload,
} from './email-verification.js';
export {
  enqueueLeadResearch,
  LEAD_RESEARCH_JOB_OPTIONS,
  type LeadResearchQueuePayload,
} from './lead-research.js';
export { publishWorkflowEvent, type PublishWorkflowEventInput } from './workflow-events.js';
export { registerWorkerShutdown, type GracefulShutdownOptions } from './shutdown.js';
export { recoverStuckDiscoveryJobs, recoverStuckVerificationJobs } from './recovery.js';
export {
  enqueueCampaignEnrollment,
  CAMPAIGN_ENROLLMENT_JOB_OPTIONS,
  BULK_ENROLLMENT_THRESHOLD,
  type CampaignEnrollmentQueuePayload,
} from './campaign-enrollment.js';
export {
  enqueueLeadImport,
  LEAD_IMPORT_JOB_OPTIONS,
  type LeadImportQueuePayload,
} from './lead-import.js';
export {
  enqueueLeadProcessing,
  LEAD_PROCESSING_JOB_OPTIONS,
  type LeadProcessingQueuePayload,
  type StagedLeadFilterPayload,
} from './lead-processing.js';
