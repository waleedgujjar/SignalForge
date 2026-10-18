import { prisma } from '@signalforge/database';
import type { LeadOutcomeSource, LeadOutcomeType, Prisma } from '@signalforge/database';
import { publishWorkflowEvent } from '@signalforge/automations';

export interface RecordOutcomeInput {
  workspaceId: string;
  leadId: string;
  type: LeadOutcomeType;
  campaignId?: string | null;
  conversationId?: string | null;
  source?: LeadOutcomeSource;
  occurredAt?: Date;
  recordedById?: string | null;
  note?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface ListOutcomesInput {
  workspaceId: string;
  type?: LeadOutcomeType;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export class LeadOutcomeNotFoundError extends Error {}

/**
 * Records real business outcomes against a lead.
 *
 * This is the only writer of meeting and conversion counts. Nothing infers a
 * meeting from a positive reply, so the meetings KPI is either backed by an
 * event somebody logged or it is zero.
 */
export class OutcomeService {
  async record(input: RecordOutcomeInput) {
    // Resolving the lead inside the workspace both validates the reference and
    // stops a caller from attaching an outcome to another tenant's lead.
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!lead) throw new LeadOutcomeNotFoundError('Lead not found in this workspace.');

    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: input.campaignId, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!campaign) throw new LeadOutcomeNotFoundError('Campaign not found in this workspace.');
    }

    const event = await prisma.leadOutcomeEvent.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        campaignId: input.campaignId ?? null,
        conversationId: input.conversationId ?? null,
        type: input.type,
        source: input.source ?? 'MANUAL',
        occurredAt: input.occurredAt ?? new Date(),
        recordedAt: new Date(),
        recordedById: input.recordedById ?? null,
        note: input.note ?? null,
        metadata: input.metadata ?? {},
      },
    });

    if (input.type === 'MEETING_BOOKED') {
      void publishWorkflowEvent({
        eventType: 'MEETING_BOOKED',
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        campaignId: input.campaignId ?? undefined,
        conversationId: input.conversationId ?? undefined,
        idempotencyKey: `meeting-booked:${event.id}`,
      }).catch(() => {});
    }

    if (input.type === 'QUALIFIED') {
      void publishWorkflowEvent({
        eventType: 'LEAD_QUALIFIED',
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        campaignId: input.campaignId ?? undefined,
        idempotencyKey: `lead-qualified-outcome:${event.id}`,
      }).catch(() => {});
    }

    return event;
  }

  async list(input: ListOutcomesInput) {
    const where: Prisma.LeadOutcomeEventWhereInput = {
      workspaceId: input.workspaceId,
      ...(input.type ? { type: input.type } : {}),
      ...(input.from || input.to
        ? { occurredAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.leadOutcomeEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
        include: {
          lead: { select: { id: true, email: true, fullName: true, company: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
      prisma.leadOutcomeEvent.count({ where }),
    ]);

    return { items, total };
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    const result = await prisma.leadOutcomeEvent.deleteMany({ where: { id, workspaceId } });
    if (result.count === 0) throw new LeadOutcomeNotFoundError('Outcome not found.');
  }
}

export const outcomeService = new OutcomeService();
