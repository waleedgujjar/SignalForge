import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import { decryptSecret, createSmtpProvider } from '@signalforge/email';
import { logInboxEvent } from '@signalforge/inbox';
import type { InboxReplyQueuePayload } from '@signalforge/queue';

export type InboxReplyPipelineOutcome =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; reason: string; retryable?: boolean };

function parsePrimaryRecipient(toRecipients: unknown): string | null {
  if (!Array.isArray(toRecipients) || toRecipients.length === 0) return null;
  const first = toRecipients[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'email' in first) {
    const email = (first as { email?: unknown }).email;
    return typeof email === 'string' && email.length > 0 ? email : null;
  }
  return null;
}

function buildThreadHeaders(
  messages: Array<{ internetMessageId: string | null; direction: string }>,
  fallbackInReplyTo?: string | null,
): { inReplyTo?: string; references: string[] } {
  const references = messages
    .map((message) => message.internetMessageId)
    .filter((id): id is string => Boolean(id));

  const latestInbound = [...messages]
    .reverse()
    .find((message) => message.direction === 'INBOUND' && message.internetMessageId);

  const inReplyTo = latestInbound?.internetMessageId ?? fallbackInReplyTo ?? undefined;
  return { inReplyTo, references };
}

export async function processInboxReplyJob(
  payload: InboxReplyQueuePayload,
): Promise<InboxReplyPipelineOutcome> {
  const start = Date.now();
  const env = loadEnv();

  logInboxEvent('Processing inbox reply job', {
    workspaceId: payload.workspaceId,
    mailboxId: payload.mailboxId,
    conversationId: payload.conversationId,
    messageId: payload.conversationMessageId,
    status: 'processing',
  });

  const message = await prisma.conversationMessage.findFirst({
    where: {
      id: payload.conversationMessageId,
      workspaceId: payload.workspaceId,
      conversationId: payload.conversationId,
      mailboxId: payload.mailboxId,
      direction: 'OUTBOUND',
      status: 'DEFERRED',
    },
  });

  if (!message) {
    return { ok: false, reason: 'MESSAGE_NOT_DEFERRED' };
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: payload.workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return { ok: false, reason: 'WORKSPACE_NOT_FOUND' };
  }

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: payload.mailboxId, workspaceId: payload.workspaceId },
    include: { credential: true },
  });
  if (!mailbox?.credential || !mailbox.smtpHost || !mailbox.smtpPort) {
    await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED' },
    });
    return { ok: false, reason: 'MISSING_SMTP_CONFIGURATION' };
  }

  const recipient = parsePrimaryRecipient(message.toRecipients);
  if (!recipient) {
    await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED' },
    });
    return { ok: false, reason: 'MISSING_RECIPIENT' };
  }

  const threadMessages = await prisma.conversationMessage.findMany({
    where: { conversationId: payload.conversationId, workspaceId: payload.workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { internetMessageId: true, direction: true },
  });
  const { inReplyTo, references } = buildThreadHeaders(threadMessages, message.inReplyTo);

  const password = decryptSecret(mailbox.credential.encryptedPayload, env.ENCRYPTION_KEY);
  const provider = createSmtpProvider({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    username: mailbox.smtpUsername ?? mailbox.emailAddress,
    password,
    encryption: mailbox.encryptionType,
    fromEmail: mailbox.emailAddress,
    fromName: mailbox.fromName,
  });

  try {
    const sendResult = await provider.send({
      to: recipient,
      subject: message.subject ?? 'Re: Your message',
      body: message.textBody ?? '',
      html: message.htmlBodySanitized ?? undefined,
      inReplyTo,
      references,
    });

    const sentAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.conversationMessage.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          sentAt,
          providerMessageId: sendResult.messageId ?? null,
          internetMessageId: sendResult.messageId ?? null,
          inReplyTo: inReplyTo ?? message.inReplyTo,
          references,
        },
      });

      await tx.conversation.update({
        where: { id: payload.conversationId },
        data: {
          lastMessageAt: sentAt,
          status: 'WAITING',
        },
      });

      await tx.conversationActivity.create({
        data: {
          conversationId: payload.conversationId,
          workspaceId: payload.workspaceId,
          type: 'MESSAGE_SENT',
          summary: `Reply sent to ${recipient}`,
          metadata: {
            messageId: message.id,
            providerMessageId: sendResult.messageId ?? null,
          },
        },
      });
    });

    logInboxEvent('Inbox reply sent', {
      workspaceId: payload.workspaceId,
      mailboxId: payload.mailboxId,
      conversationId: payload.conversationId,
      messageId: message.id,
      status: 'sent',
      durationMs: Date.now() - start,
    });

    return { ok: true, providerMessageId: sendResult.messageId ?? null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Reply send failed';
    await prisma.conversationMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED' },
    });

    logInboxEvent('Inbox reply failed', {
      workspaceId: payload.workspaceId,
      mailboxId: payload.mailboxId,
      conversationId: payload.conversationId,
      messageId: message.id,
      error: errorMessage,
      status: 'failed',
      durationMs: Date.now() - start,
    });

    return { ok: false, reason: errorMessage, retryable: true };
  }
}
