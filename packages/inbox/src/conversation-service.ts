import { prisma, type Conversation, type ConversationStatus, type Prisma } from '@signalforge/database';
import type { ConversationMatchStatus, ReplyClassification } from '@signalforge/database';
import { logInboxEvent } from './activity.js';

export interface FindOrCreateConversationInput {
  workspaceId: string;
  mailboxId: string;
  conversationId?: string | null;
  leadId?: string | null;
  campaignId?: string | null;
  campaignLeadId?: string | null;
  subject?: string | null;
  matchStatus: ConversationMatchStatus;
  receivedAt: Date;
}

export class ConversationService {
  async findById(conversationId: string, workspaceId: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
    });
  }

  async findOrCreate(input: FindOrCreateConversationInput): Promise<Conversation> {
    if (input.conversationId) {
      const existing = await this.findById(input.conversationId, input.workspaceId);
      if (existing) return existing;
    }

    const created = await prisma.conversation.create({
      data: {
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        leadId: input.leadId ?? null,
        campaignId: input.campaignId ?? null,
        campaignLeadId: input.campaignLeadId ?? null,
        subject: input.subject ?? null,
        matchStatus: input.matchStatus,
        status: 'OPEN',
        lastMessageAt: input.receivedAt,
        lastInboundAt: input.receivedAt,
        unreadCount: 1,
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: created.id,
        workspaceId: input.workspaceId,
        type: 'CREATED',
        summary: 'Conversation created from inbound message',
        metadata: {
          matchStatus: input.matchStatus,
          leadId: input.leadId,
          campaignId: input.campaignId,
        },
      },
    });

    logInboxEvent('Conversation created', {
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      conversationId: created.id,
      status: 'created',
    });

    return created;
  }

  async updateAfterInbound(
    conversationId: string,
    workspaceId: string,
    input: {
      receivedAt: Date;
      classification?: ReplyClassification | null;
      classificationSource?: import('@signalforge/database').ClassificationSource | null;
      classificationConfidence?: number | null;
      classificationSummary?: string | null;
      suggestedAction?: string | null;
      leadId?: string | null;
      campaignId?: string | null;
      campaignLeadId?: string | null;
      matchStatus?: ConversationMatchStatus;
    },
  ): Promise<Conversation> {
    const data: Prisma.ConversationUpdateInput = {
      lastMessageAt: input.receivedAt,
      lastInboundAt: input.receivedAt,
      unreadCount: { increment: 1 },
      ...(input.leadId ? { lead: { connect: { id: input.leadId } } } : {}),
      ...(input.campaignId ? { campaign: { connect: { id: input.campaignId } } } : {}),
      ...(input.campaignLeadId ? { campaignLead: { connect: { id: input.campaignLeadId } } } : {}),
      ...(input.matchStatus ? { matchStatus: input.matchStatus } : {}),
    };

    if (input.classification) {
      data.classification = input.classification;
      data.classificationSource = input.classificationSource ?? 'SYSTEM';
      data.classificationConfidence = input.classificationConfidence ?? null;
      data.classificationSummary = input.classificationSummary ?? null;
      data.suggestedAction = input.suggestedAction ?? null;
      data.classifiedAt = new Date();
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data,
    });

    if (!conversation.firstReplyAt) {
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { firstReplyAt: input.receivedAt },
      });
    }

    return conversation;
  }

  async updateStatus(
    conversationId: string,
    workspaceId: string,
    status: ConversationStatus,
    actorUserId?: string | null,
  ): Promise<Conversation> {
    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        ...(status === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId,
        workspaceId,
        actorUserId: actorUserId ?? null,
        type: status === 'ARCHIVED' ? 'ARCHIVED' : 'CLASSIFICATION_CHANGED',
        summary: `Conversation status changed to ${status}`,
        metadata: { status },
      },
    });

    return conversation;
  }

  async markRead(conversationId: string, workspaceId: string, actorUserId?: string | null): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
    await prisma.conversationActivity.create({
      data: {
        conversationId,
        workspaceId,
        actorUserId: actorUserId ?? null,
        type: 'READ',
        summary: 'Conversation marked as read',
      },
    });
  }

  async listConversations(
    workspaceId: string,
    filters?: {
      status?: ConversationStatus;
      mailboxId?: string;
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    return prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.mailboxId ? { mailboxId: filters.mailboxId } : {}),
        ...(filters?.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      include: {
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
        campaign: { select: { id: true, name: true } },
        mailbox: { select: { id: true, emailAddress: true, fromName: true } },
      },
    });
  }
}

export const conversationService = new ConversationService();
