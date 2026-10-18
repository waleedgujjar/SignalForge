import type { Queue, JobsOptions } from 'bullmq';

export interface AnalyticsAggregationPayload {
  workspaceId: string;
  /// UTC day to aggregate, as an ISO date (YYYY-MM-DD).
  snapshotDate: string;
}

export const ANALYTICS_AGGREGATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60_000,
  },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export async function enqueueAnalyticsAggregation(
  queue: Queue<AnalyticsAggregationPayload>,
  payload: AnalyticsAggregationPayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('analytics-aggregation', payload, {
    ...ANALYTICS_AGGREGATION_JOB_OPTIONS,
    delay: options?.delayMs,
    // Deterministic id collapses repeat ticks for the same workspace-day into
    // one queued job; the rollup upsert makes re-running it harmless anyway.
    jobId: options?.jobId ?? `analytics-agg-${payload.workspaceId}-${payload.snapshotDate}`,
  });
}
