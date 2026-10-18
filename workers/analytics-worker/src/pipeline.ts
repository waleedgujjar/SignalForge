import { analyticsAggregationService } from '@signalforge/analytics';
import type { AnalyticsAggregationPayload } from '@signalforge/queue';

export type JobOutcome =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; reason: string; retryable: boolean };

/**
 * Rebuilds the daily analytics rollup for one workspace-day. The snapshot
 * upserts on `[workspaceId, snapshotDate]`, so a retried or re-queued job
 * overwrites the row rather than adding to it.
 */
export async function processAnalyticsAggregationJob(
  payload: AnalyticsAggregationPayload,
): Promise<JobOutcome> {
  const day = new Date(`${payload.snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) {
    return { ok: false, reason: 'INVALID_SNAPSHOT_DATE', retryable: false };
  }

  try {
    const result = await analyticsAggregationService.aggregateWorkspaceDay(
      payload.workspaceId,
      day,
    );
    return { ok: true, detail: { ...result } };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'ANALYTICS_AGGREGATION_FAILED',
      retryable: true,
    };
  }
}
