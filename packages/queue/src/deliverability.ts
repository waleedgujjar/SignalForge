import type { Queue, JobsOptions } from 'bullmq';

export interface DeliverabilityAggregationPayload {
  workspaceId: string;
  /// UTC day to aggregate, as an ISO date (YYYY-MM-DD).
  snapshotDate: string;
}

export interface DomainHealthCheckPayload {
  workspaceId: string;
  domain: string;
  force?: boolean;
}

export const DELIVERABILITY_AGGREGATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export const DOMAIN_HEALTH_CHECK_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 120_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export async function enqueueDeliverabilityAggregation(
  queue: Queue<DeliverabilityAggregationPayload>,
  payload: DeliverabilityAggregationPayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('deliverability-aggregation', payload, {
    ...DELIVERABILITY_AGGREGATION_JOB_OPTIONS,
    delay: options?.delayMs,
    // Deterministic id collapses repeat ticks for the same workspace-day into
    // one queued job, keeping aggregation idempotent end to end.
    jobId: options?.jobId ?? `deliverability-agg-${payload.workspaceId}-${payload.snapshotDate}`,
  });
}

export async function enqueueDomainHealthCheck(
  queue: Queue<DomainHealthCheckPayload>,
  payload: DomainHealthCheckPayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('domain-health-check', payload, {
    ...DOMAIN_HEALTH_CHECK_JOB_OPTIONS,
    delay: options?.delayMs,
    jobId: options?.jobId ?? `domain-check-${payload.workspaceId}-${payload.domain}`,
  });
}
