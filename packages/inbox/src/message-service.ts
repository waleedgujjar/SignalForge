import DOMPurify from 'isomorphic-dompurify';
import { prisma, type Prisma } from '@signalforge/database';
import type { InboundMessage } from '@signalforge/inbound';
import type { ReplyClassification } from '@signalforge/database';
import { logInboxEvent } from './activity.js';

export interface CreateInboundMessageInput {
  workspaceId: string;
  mailboxId: string;
  conversationId: string;
  message: InboundMessage;
  emailMessageId?: string | null;
  classification?: ReplyClassification | null;
}

export class MessageService {
  sanitizeHtml(html: string | null | undefined): string | null {
    if (!html) return null;
    const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return sanitized.trim() || null;
  }

  async createInboundMessage(input: CreateInboundMessageInput) {
    const { message } = input;
    const record = await prisma.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        direction: 'INBOUND',
        providerMessageId: message.providerMessageId,
        internetMessageId: message.internetMessageId ?? null,
        inReplyTo: message.inReplyTo ?? null,
        references: message.references as unknown as Prisma.InputJsonValue,
        fromEmail: message.from.email,
        fromName: message.from.name ?? null,
        toRecipients: message.to as unknown as Prisma.InputJsonValue,
        ccRecipients: message.cc as unknown as Prisma.InputJsonValue,
        bccRecipients: message.bcc as unknown as Prisma.InputJsonValue,
        subject: message.subject ?? null,
        textBody: message.textBody ?? null,
        htmlBodySanitized: this.sanitizeHtml(message.htmlBody),
        attachmentsMetadata: message.attachments as unknown as Prisma.InputJsonValue,
        receivedAt: message.receivedAt,
        status: 'RECEIVED',
        classification: input.classification ?? null,
        emailMessageId: input.emailMessageId ?? null,
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        type: 'MESSAGE_RECEIVED',
        summary: `Inbound message received from ${message.from.email}`,
        metadata: {
          messageId: record.id,
          subject: message.subject,
        },
      },
    });

    logInboxEvent('Inbound message stored', {
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      conversationId: input.conversationId,
      messageId: record.id,
      status: 'received',
    });

    return record;
  }

  async listMessages(conversationId: string, workspaceId: string) {
    return prisma.conversationMessage.findMany({
      where: { conversationId, workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getLatestInboundBody(conversationId: string, workspaceId: string): Promise<string> {
    const latest = await prisma.conversationMessage.findFirst({
      where: { conversationId, workspaceId, direction: 'INBOUND' },
      orderBy: { receivedAt: 'desc' },
      select: { textBody: true, htmlBodySanitized: true, subject: true },
    });
    if (!latest) return '';
    return latest.textBody ?? stripTags(latest.htmlBodySanitized) ?? latest.subject ?? '';
  }
}

function stripTags(html: string | null | undefined): string | null {
  if (!html) return null;
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const messageService = new MessageService();
