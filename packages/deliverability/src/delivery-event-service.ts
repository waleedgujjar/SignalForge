import { createHash } from 'node:crypto';
import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import type { BounceType, DeliveryEventSource, DeliveryEventType } from './types.js';

export interface RecordDeliveryEventInput {
  workspaceId: string;
  eventType: DeliveryEventType;
  /// Stable key identifying the real-world occurrence. Two calls with the same
  /// key record one row, so retried worker jobs cannot inflate metrics.
  idempotencyKey: string;
  emailMessageId?: string | null;
  sendingJobId?: string | null;
  mailboxId?: string | null;
  leadId?: string | null;
  campaignId?: string | null;
  bounceType?: BounceType | null;
  smtpStatusCode?: string | null;
  enhancedStatusCode?: string | null;
  providerResponse?: string | null;
  source?: DeliveryEventSource;
  occurredAt?: Date;
  metadata?: Prisma.InputJsonValue;
}

export interface RecordDeliveryEventResult {
  id: string;
  created: boolean;
}

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  const raw = parts.filter((part) => part !== null && part !== undefined).join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 48);
}

export class DeliveryEventService {
  /**
   * Records a delivery signal. Duplicates are ignored rather than merged: the
   * first observation of an event wins, matching how the aggregation layer
   * counts distinct occurrences.
   */
  async recordEvent(
    input: RecordDeliveryEventInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<RecordDeliveryEventResult> {
    const existing = await client.emailDeliveryEvent.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { id: existing.id, created: false };
    }

    try {
      const created = await client.emailDeliveryEvent.create({
        data: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          emailMessageId: input.emailMessageId ?? null,
          sendingJobId: input.sendingJobId ?? null,
          mailboxId: input.mailboxId ?? null,
          leadId: input.leadId ?? null,
          campaignId: input.campaignId ?? null,
          bounceType: input.bounceType ?? null,
          smtpStatusCode: input.smtpStatusCode ?? null,
          enhancedStatusCode: input.enhancedStatusCode ?? null,
          providerResponse: input.providerResponse ?? null,
          source: input.source ?? 'SENDING',
          occurredAt: input.occurredAt ?? new Date(),
          metadata: input.metadata ?? {},
        },
        select: { id: true },
      });
      return { id: created.id, created: true };
    } catch (error) {
      // Concurrent writers can race past the existence check; the unique index
      // is the real guard, so treat a duplicate as a successful no-op.
      if (isUniqueViolation(error)) {
        const row = await client.emailDeliveryEvent.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: input.workspaceId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (row) return { id: row.id, created: false };
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export const deliveryEventService = new DeliveryEventService();
