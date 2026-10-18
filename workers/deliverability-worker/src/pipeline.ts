import {
  deliverabilityAggregationService,
  deliverabilityAlertService,
  domainHealthService,
  buildDomainRecommendations,
  DomainHealthCheckRateLimitError,
  type AggregationResult,
} from '@signalforge/deliverability';
import type {
  DeliverabilityAggregationPayload,
  DomainHealthCheckPayload,
} from '@signalforge/queue';

export type JobOutcome =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; reason: string; retryable: boolean };

/**
 * Rebuilds daily snapshots for one workspace-day. Snapshots upsert on
 * `[entity, date]`, so re-running the same job produces the same rows rather
 * than duplicating counts.
 */
export async function processAggregationJob(
  payload: DeliverabilityAggregationPayload,
): Promise<JobOutcome> {
  const day = new Date(`${payload.snapshotDate}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) {
    return { ok: false, reason: 'INVALID_SNAPSHOT_DATE', retryable: false };
  }

  try {
    const result: AggregationResult = await deliverabilityAggregationService.aggregateWorkspaceDay(
      payload.workspaceId,
      day,
    );
    return { ok: true, detail: { ...result, snapshotDate: payload.snapshotDate } };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'AGGREGATION_FAILED',
      retryable: true,
    };
  }
}

/**
 * Refreshes cached DNS authentication results and raises a domain alert when a
 * check comes back FAIL or INVALID. UNKNOWN results never raise an alert.
 */
export async function processDomainCheckJob(payload: DomainHealthCheckPayload): Promise<JobOutcome> {
  try {
    const record = await domainHealthService.runCheck(payload.workspaceId, payload.domain, {
      force: payload.force ?? false,
    });

    await deliverabilityAlertService.evaluateDomain({
      workspaceId: payload.workspaceId,
      domain: record,
      recommendation: buildDomainRecommendations(record)[0] ?? null,
    });

    return {
      ok: true,
      detail: {
        domain: record.domain,
        spf: record.spfStatus,
        dkim: record.dkimStatus,
        dmarc: record.dmarcStatus,
        mx: record.mxStatus,
      },
    };
  } catch (error) {
    if (error instanceof DomainHealthCheckRateLimitError) {
      return { ok: false, reason: 'RATE_LIMITED', retryable: false };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'DOMAIN_CHECK_FAILED',
      retryable: true,
    };
  }
}
