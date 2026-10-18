import type { Queue } from 'bullmq';
import { enqueueAnalyticsAggregation } from '@signalforge/queue';
import { analyticsAggregationService } from './aggregation-service.js';
import { startOfUtcDay } from './metrics/range.js';

export interface AnalyticsAggregationPayload {
  workspaceId: string;
  snapshotDate: string;
}

export interface AnalyticsSchedulerTickResult {
  aggregationsQueued: number;
}

const DAY_MS = 86_400_000;

/**
 * Enqueues daily analytics rollups from the shared scheduler tick.
 *
 * Today and yesterday are both re-queued each tick: today because it is still
 * accumulating, yesterday because replies and bounces regularly land after the
 * UTC day has rolled over. Job IDs are deterministic per workspace-day, so a
 * tick that fires while the previous batch is still pending collapses into the
 * existing job instead of duplicating work.
 */
export class AnalyticsSchedulerService {
  constructor(private readonly aggregationQueue: Queue<AnalyticsAggregationPayload>) {}

  async queueAggregations(now: Date = new Date()): Promise<number> {
    const today = startOfUtcDay(now);
    const yesterday = new Date(today.getTime() - DAY_MS);
    const workspaces = await analyticsAggregationService.findActiveWorkspaces(yesterday, now);

    let queued = 0;
    for (const workspaceId of workspaces) {
      for (const day of [today, yesterday]) {
        const snapshotDate = day.toISOString().slice(0, 10);
        await enqueueAnalyticsAggregation(this.aggregationQueue, { workspaceId, snapshotDate });
        queued += 1;
      }
    }
    return queued;
  }

  async runTick(now: Date = new Date()): Promise<AnalyticsSchedulerTickResult> {
    return { aggregationsQueued: await this.queueAggregations(now) };
  }
}

export function createAnalyticsSchedulerService(
  aggregationQueue: Queue<AnalyticsAggregationPayload>,
): AnalyticsSchedulerService {
  return new AnalyticsSchedulerService(aggregationQueue);
}

/// Runs a queued rollup. Shared by the worker and any manual re-aggregation.
export async function runAnalyticsAggregationJob(payload: AnalyticsAggregationPayload) {
  return analyticsAggregationService.aggregateWorkspaceDay(
    payload.workspaceId,
    new Date(`${payload.snapshotDate}T00:00:00.000Z`),
  );
}
