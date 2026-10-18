import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '@signalforge/database';
import type { Prisma, ReplyClassification } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import { createAIProvider } from '@signalforge/ai';
import {
  conversationService,
  messageService,
  noteService,
  statsService,
  createSendReplyService,
  createReplyComposer,
} from '@signalforge/inbox';
import {
  conversationListQuerySchema,
  sendInboxReplySchema,
  updateConversationSchema,
  createConversationNoteSchema,
  manualMatchConversationSchema,
} from '@signalforge/validation';
import { QUEUE_NAMES, createQueue, createRedisConnection, type InboxReplyQueuePayload } from '@signalforge/queue';
import { getWorkspaceId, requireWorkspaceGuard } from '../plugins/auth.js';

function getInboxReplyQueue() {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  return createQueue<InboxReplyQueuePayload>(QUEUE_NAMES.INBOX_REPLY, connection);
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof Error) {
    if (/not found/i.test(error.message)) {
      return reply.status(404).send({ error: error.message });
    }
    return reply.status(400).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

function summarizeConversation(row: {
  id: string;
  subject: string | null;
  status: string;
  matchStatus: string;
  classification: ReplyClassification | null;
  classificationConfidence: number | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  assignedUserId: string | null;
  lead: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
  } | null;
  campaign: { id: string; name: string } | null;
  mailbox: { id: string; emailAddress: string; fromName: string };
}) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    matchStatus: row.matchStatus,
    classification: row.classification,
    classificationConfidence: row.classificationConfidence,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    assignedUserId: row.assignedUserId,
    lead: row.lead
      ? {
          id: row.lead.id,
          email: row.lead.email,
          name: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ') || null,
          company: row.lead.company,
        }
      : null,
    campaign: row.campaign,
    mailbox: row.mailbox,
  };
}

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  const env = loadEnv();
  const aiProvider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });
  const replyComposer = createReplyComposer(aiProvider);

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const mailboxId = (request.query as { mailboxId?: string }).mailboxId;
    const stats = await statsService.getWorkspaceStats(workspaceId, mailboxId);
    const syncHealth = await statsService.getMailboxSyncHealth(workspaceId);
    return { stats, syncHealth };
  });

  app.get('/conversations', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = conversationListQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const where: Prisma.ConversationWhereInput = {
      workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.classification ? { classification: query.classification } : {}),
      ...(query.matchStatus ? { matchStatus: query.matchStatus } : {}),
      ...(query.mailboxId ? { mailboxId: query.mailboxId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { lead: { email: { contains: query.search, mode: 'insensitive' } } },
              { lead: { company: { contains: query.search, mode: 'insensitive' } } },
              { lead: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { lead: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: query.limit,
        skip,
        include: {
          lead: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
            },
          },
          campaign: { select: { id: true, name: true } },
          mailbox: { select: { id: true, emailAddress: true, fromName: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return {
      data: rows.map(summarizeConversation),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  });

  app.get('/conversations/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, workspaceId },
      include: {
        lead: true,
        campaign: { select: { id: true, name: true, replyHandlingPolicy: true } },
        campaignLead: { select: { id: true, status: true, repliedAt: true } },
        mailbox: { select: { id: true, emailAddress: true, fromName: true, inboundStatus: true } },
        notes: { orderBy: { createdAt: 'desc' }, take: 20 },
        activities: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const messages = await messageService.listMessages(id, workspaceId);

    return {
      conversation: {
        ...summarizeConversation({
          ...conversation,
          lead: conversation.lead
            ? {
                id: conversation.lead.id,
                email: conversation.lead.email,
                firstName: conversation.lead.firstName,
                lastName: conversation.lead.lastName,
                company: conversation.lead.company,
              }
            : null,
          campaign: conversation.campaign,
          mailbox: conversation.mailbox,
        }),
        classificationSource: conversation.classificationSource,
        classificationSummary: conversation.classificationSummary,
        suggestedAction: conversation.suggestedAction,
        campaignLead: conversation.campaignLead,
        replyHandlingPolicy: conversation.campaign?.replyHandlingPolicy ?? null,
      },
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        subject: m.subject,
        textBody: m.textBody,
        htmlBodySanitized: m.htmlBodySanitized,
        attachmentsMetadata: m.attachmentsMetadata,
        receivedAt: m.receivedAt?.toISOString() ?? null,
        sentAt: m.sentAt?.toISOString() ?? null,
        status: m.status,
        classification: m.classification,
        createdAt: m.createdAt.toISOString(),
      })),
      notes: conversation.notes,
      activities: conversation.activities,
    };
  });

  app.patch('/conversations/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = updateConversationSchema.parse(request.body);

    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });

    try {
      const updated = await prisma.conversation.update({
        where: { id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.classification
            ? {
                classification: body.classification,
                classificationSource: 'USER',
                classifiedAt: new Date(),
              }
            : {}),
          ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
        },
        include: {
          lead: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
            },
          },
          campaign: { select: { id: true, name: true } },
          mailbox: { select: { id: true, emailAddress: true, fromName: true } },
        },
      });

      if (body.classification) {
        await prisma.conversationActivity.create({
          data: {
            conversationId: id,
            workspaceId,
            type: 'CLASSIFICATION_CHANGED',
            summary: `Classification changed to ${body.classification}`,
            metadata: { classification: body.classification, source: 'USER' },
          },
        });
      }

      return summarizeConversation(updated);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/conversations/:id/read', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });
    await conversationService.markRead(id, workspaceId);
    return { ok: true };
  });

  app.post('/conversations/:id/unread', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });
    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 1 },
    });
    return { ok: true };
  });

  app.post('/conversations/:id/archive', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });
    const updated = await conversationService.updateStatus(id, workspaceId, 'ARCHIVED');
    return { ok: true, status: updated.status };
  });

  app.post('/conversations/:id/reply', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = sendInboxReplySchema.parse(request.body);

    try {
      const sendReplyService = createSendReplyService(getInboxReplyQueue());
      const result = await sendReplyService.sendReply({
        conversationId: id,
        workspaceId,
        subject: body.subject,
        body: body.body,
        htmlBody: body.htmlBody,
      });
      return result;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/conversations/:id/compose-draft', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      const draft = await replyComposer.composeDraft({ conversationId: id, workspaceId });
      return draft;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/conversations/:id/note', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = createConversationNoteSchema.parse(request.body);
    const userId = request.user?.userId;
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });

    try {
      const note = await noteService.create({
        conversationId: id,
        workspaceId,
        authorId: userId,
        content: body.content,
      });
      return note;
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post('/conversations/:id/match', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const body = manualMatchConversationSchema.parse(request.body);

    const existing = await conversationService.findById(id, workspaceId);
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });

    if (body.leadId) {
      const lead = await prisma.lead.findFirst({ where: { id: body.leadId, workspaceId } });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
    }
    if (body.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: body.campaignId, workspaceId },
      });
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' });
    }

    const matchStatus =
      body.leadId && body.campaignId ? 'MATCHED' : body.leadId || body.campaignId ? 'PARTIAL' : 'UNMATCHED';

    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        leadId: body.leadId ?? null,
        campaignId: body.campaignId ?? null,
        matchStatus,
      },
      include: {
        lead: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
        campaign: { select: { id: true, name: true } },
        mailbox: { select: { id: true, emailAddress: true, fromName: true } },
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: id,
        workspaceId,
        type: 'MANUAL_MATCH',
        summary: 'Conversation manually matched to lead/campaign',
        metadata: { leadId: body.leadId, campaignId: body.campaignId },
      },
    });

    return summarizeConversation(updated);
  });
};
