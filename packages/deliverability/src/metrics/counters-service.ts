import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import type { DeliveryCounters } from '../types.js';
import { EMPTY_COUNTERS } from './formulas.js';

export interface CounterWindow {
  workspaceId: string;
  from: Date;
  to: Date;
  mailboxId?: string;
  campaignId?: string;
}

/**
 * Derives raw counters from the delivery event log.
 *
 * The event log is the single measurement surface: outbound sends, bounces and
 * failures are written by the email worker, and unsubscribes/replies are mirrored
 * from Module 12. Reading one table keeps every rate internally consistent.
 */
export class CountersService {
  async getCounters(window: CounterWindow): Promise<DeliveryCounters> {
    const where: Prisma.EmailDeliveryEventWhereInput = {
      workspaceId: window.workspaceId,
      occurredAt: { gte: window.from, lte: window.to },
      ...(window.mailboxId ? { mailboxId: window.mailboxId } : {}),
      ...(window.campaignId ? { campaignId: window.campaignId } : {}),
    };

    const [groups, uniqueRepliedLeads, bounceGroups] = await Promise.all([
      prisma.emailDeliveryEvent.groupBy({
        by: ['eventType'],
        where,
        _count: { _all: true },
      }),
      prisma.emailDeliveryEvent.findMany({
        where: { ...where, eventType: 'REPLY', leadId: { not: null } },
        distinct: ['leadId'],
        select: { leadId: true },
      }),
      prisma.emailDeliveryEvent.groupBy({
        by: ['bounceType'],
        where: { ...where, eventType: 'BOUNCED' },
        _count: { _all: true },
      }),
    ]);

    const byType = new Map(groups.map((row) => [row.eventType, row._count._all]));
    const sent = byType.get('SENT') ?? 0;
    const delivered = byType.get('DELIVERED') ?? sent;
    const bounced = byType.get('BOUNCED') ?? 0;
    const failed = byType.get('FAILED') ?? 0;
    const complaints = byType.get('COMPLAINT') ?? 0;

    const hardBounces = bounceGroups.find((row) => row.bounceType === 'HARD')?._count._all ?? 0;
    const softBounces = bounceGroups.find((row) => row.bounceType === 'SOFT')?._count._all ?? 0;

    return {
      ...EMPTY_COUNTERS,
      attempted: sent + bounced + failed,
      sent,
      delivered,
      bounced,
      hardBounces,
      softBounces,
      failed,
      replies: byType.get('REPLY') ?? 0,
      uniqueRepliedLeads: uniqueRepliedLeads.length,
      unsubscribes: byType.get('UNSUBSCRIBE') ?? 0,
      complaints,
      complaintDataAvailable: complaints > 0,
    };
  }

  /// Counters grouped by mailbox, for the comparison table.
  async getCountersByMailbox(window: Omit<CounterWindow, 'mailboxId'>): Promise<Map<string, DeliveryCounters>> {
    const rows = await prisma.emailDeliveryEvent.groupBy({
      by: ['mailboxId', 'eventType', 'bounceType'],
      where: {
        workspaceId: window.workspaceId,
        occurredAt: { gte: window.from, lte: window.to },
        mailboxId: { not: null },
        ...(window.campaignId ? { campaignId: window.campaignId } : {}),
      },
      _count: { _all: true },
    });

    const replyRows = await prisma.emailDeliveryEvent.findMany({
      where: {
        workspaceId: window.workspaceId,
        occurredAt: { gte: window.from, lte: window.to },
        eventType: 'REPLY',
        mailboxId: { not: null },
        leadId: { not: null },
      },
      distinct: ['mailboxId', 'leadId'],
      select: { mailboxId: true },
    });

    const result = new Map<string, DeliveryCounters>();
    const bump = (key: string): DeliveryCounters => {
      const existing = result.get(key);
      if (existing) return existing;
      const created = { ...EMPTY_COUNTERS };
      result.set(key, created);
      return created;
    };

    for (const row of rows) {
      if (!row.mailboxId) continue;
      applyGroupRow(bump(row.mailboxId), row.eventType, row.bounceType, row._count._all);
    }
    for (const row of replyRows) {
      if (!row.mailboxId) continue;
      bump(row.mailboxId).uniqueRepliedLeads += 1;
    }
    for (const counters of result.values()) {
      counters.attempted = counters.sent + counters.bounced + counters.failed;
      if (counters.delivered === 0) counters.delivered = counters.sent;
    }

    return result;
  }

  /// Counters grouped by campaign, for the campaign comparison table.
  async getCountersByCampaign(window: Omit<CounterWindow, 'campaignId'>): Promise<Map<string, DeliveryCounters>> {
    const rows = await prisma.emailDeliveryEvent.groupBy({
      by: ['campaignId', 'eventType', 'bounceType'],
      where: {
        workspaceId: window.workspaceId,
        occurredAt: { gte: window.from, lte: window.to },
        campaignId: { not: null },
        ...(window.mailboxId ? { mailboxId: window.mailboxId } : {}),
      },
      _count: { _all: true },
    });

    const replyRows = await prisma.emailDeliveryEvent.findMany({
      where: {
        workspaceId: window.workspaceId,
        occurredAt: { gte: window.from, lte: window.to },
        eventType: 'REPLY',
        campaignId: { not: null },
        leadId: { not: null },
      },
      distinct: ['campaignId', 'leadId'],
      select: { campaignId: true },
    });

    const result = new Map<string, DeliveryCounters>();
    const bump = (key: string): DeliveryCounters => {
      const existing = result.get(key);
      if (existing) return existing;
      const created = { ...EMPTY_COUNTERS };
      result.set(key, created);
      return created;
    };

    for (const row of rows) {
      if (!row.campaignId) continue;
      applyGroupRow(bump(row.campaignId), row.eventType, row.bounceType, row._count._all);
    }
    for (const row of replyRows) {
      if (!row.campaignId) continue;
      bump(row.campaignId).uniqueRepliedLeads += 1;
    }
    for (const counters of result.values()) {
      counters.attempted = counters.sent + counters.bounced + counters.failed;
      if (counters.delivered === 0) counters.delivered = counters.sent;
    }

    return result;
  }
}

function applyGroupRow(
  counters: DeliveryCounters,
  eventType: string,
  bounceType: string | null,
  count: number,
): void {
  switch (eventType) {
    case 'SENT':
      counters.sent += count;
      break;
    case 'DELIVERED':
      counters.delivered += count;
      break;
    case 'BOUNCED':
      counters.bounced += count;
      if (bounceType === 'HARD') counters.hardBounces += count;
      if (bounceType === 'SOFT') counters.softBounces += count;
      break;
    case 'FAILED':
      counters.failed += count;
      break;
    case 'REPLY':
      counters.replies += count;
      break;
    case 'UNSUBSCRIBE':
      counters.unsubscribes += count;
      break;
    case 'COMPLAINT':
      counters.complaints += count;
      counters.complaintDataAvailable = true;
      break;
  }
}

export const countersService = new CountersService();
