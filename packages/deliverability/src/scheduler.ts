import type { Queue } from 'bullmq';
import { prisma } from '@signalforge/database';
import { deliverabilityAggregationService, startOfUtcDay } from './aggregation-service.js';
import { domainHealthService } from './domain-health-service.js';
import { normalizeDomain } from './dns-checker.js';

export interface DeliverabilityAggregationPayload {
  workspaceId: string;
  snapshotDate: string;
}

export interface DomainHealthCheckPayload {
  workspaceId: string;
  domain: string;
  force?: boolean;
}

export interface DeliverabilitySchedulerTickResult {
  aggregationsQueued: number;
  domainChecksQueued: number;
}

/// Domain re-checks queued per tick, workspace-wide, to bound DNS traffic.
const DOMAIN_CHECKS_PER_TICK = 5;

/**
 * Enqueues aggregation and DNS work from the shared scheduler tick.
 *
 * Both job types carry deterministic BullMQ ids, so a tick that fires while the
 * previous batch is still queued does not duplicate work.
 */
export class DeliverabilitySchedulerService {
  constructor(
    private readonly aggregationQueue: Queue<DeliverabilityAggregationPayload>,
    private readonly domainCheckQueue: Queue<DomainHealthCheckPayload>,
  ) {}

  async queueAggregations(now: Date = new Date()): Promise<number> {
    const today = startOfUtcDay(now);
    const yesterday = new Date(today.getTime() - 86_400_000);

    // Re-aggregate today (partial) and yesterday (in case late events landed
    // after the previous day rolled over).
    const workspaces = await deliverabilityAggregationService.findWorkspacesWithActivity(
      yesterday,
      now,
    );

    let queued = 0;
    for (const workspaceId of workspaces) {
      for (const day of [today, yesterday]) {
        const snapshotDate = day.toISOString().slice(0, 10);
        await this.aggregationQueue.add(
          'deliverability-aggregation',
          { workspaceId, snapshotDate },
          {
            jobId: `deliverability-agg-${workspaceId}-${snapshotDate}`,
            removeOnComplete: 200,
            removeOnFail: 500,
          },
        );
        queued += 1;
      }
    }
    return queued;
  }

  private async enqueueDomainCheck(workspaceId: string, domain: string): Promise<void> {
    await this.domainCheckQueue.add(
      'domain-health-check',
      { workspaceId, domain },
      { jobId: `domain-check-${workspaceId}-${domain}`, removeOnComplete: 200, removeOnFail: 500 },
    );
  }

  async queueExpiredDomainChecks(now: Date = new Date()): Promise<number> {
    const expired = await prisma.domainHealthCheck.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: DOMAIN_CHECKS_PER_TICK,
      select: { workspaceId: true, domain: true },
    });

    for (const row of expired) {
      await this.enqueueDomainCheck(row.workspaceId, row.domain);
    }
    return expired.length;
  }

  /// Sending domains (derived from mailbox addresses) that have never been
  /// checked, so a newly-added domain is inspected automatically — the user no
  /// longer has to click "Check" to discover a missing SPF/DKIM/DMARC.
  async queueNewDomainChecks(limit: number): Promise<number> {
    if (limit <= 0) return 0;
    const mailboxes = await prisma.mailbox.findMany({ select: { workspaceId: true, emailAddress: true } });
    const pairs = new Map<string, { workspaceId: string; domain: string }>();
    for (const mailbox of mailboxes) {
      const domain = normalizeDomain(mailbox.emailAddress);
      if (domain) pairs.set(`${mailbox.workspaceId}:${domain}`, { workspaceId: mailbox.workspaceId, domain });
    }
    if (pairs.size === 0) return 0;

    const existing = await prisma.domainHealthCheck.findMany({
      where: { OR: [...pairs.values()].map((p) => ({ workspaceId: p.workspaceId, domain: p.domain })) },
      select: { workspaceId: true, domain: true },
    });
    const have = new Set(existing.map((e) => `${e.workspaceId}:${e.domain}`));
    const missing = [...pairs.entries()]
      .filter(([key]) => !have.has(key))
      .map(([, value]) => value)
      .slice(0, limit);

    for (const p of missing) {
      await this.enqueueDomainCheck(p.workspaceId, p.domain);
    }
    return missing.length;
  }

  async runTick(now: Date = new Date()): Promise<DeliverabilitySchedulerTickResult> {
    const aggregationsQueued = await this.queueAggregations(now);
    const expiredQueued = await this.queueExpiredDomainChecks(now);
    // Spend the remaining per-tick DNS budget on never-checked sending domains.
    const newQueued = await this.queueNewDomainChecks(DOMAIN_CHECKS_PER_TICK - expiredQueued);
    return { aggregationsQueued, domainChecksQueued: expiredQueued + newQueued };
  }
}

export function createDeliverabilitySchedulerService(
  aggregationQueue: Queue<DeliverabilityAggregationPayload>,
  domainCheckQueue: Queue<DomainHealthCheckPayload>,
): DeliverabilitySchedulerService {
  return new DeliverabilitySchedulerService(aggregationQueue, domainCheckQueue);
}

/**
 * Runs a queued domain check and folds the outcome into alerting. Shared by the
 * worker and the on-demand API path so both produce identical side effects.
 */
export async function runDomainHealthCheckJob(payload: DomainHealthCheckPayload) {
  return domainHealthService.runCheck(payload.workspaceId, payload.domain, {
    force: payload.force ?? false,
  });
}
