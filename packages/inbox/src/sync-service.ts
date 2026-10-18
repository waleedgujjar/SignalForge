import type { AIProvider } from '@signalforge/ai';
import { prisma, Prisma } from '@signalforge/database';
import { decryptSecret } from '@signalforge/email';
import { createImapInboundProvider, type InboundMessage, type SyncCursor } from '@signalforge/inbound';
import { matchCampaignContext } from './campaign-matcher.js';
import { checkMessageDuplicate } from './deduplication.js';
import { matchLeadByEmail } from './lead-matcher.js';
import { applyReplyActions } from './reply-actions.js';
import { ReplyClassifier } from './reply-classifier.js';
import { resolveConversationThread } from './thread-resolver.js';
import { conversationService } from './conversation-service.js';
import { messageService } from './message-service.js';
import { logInboxEvent } from './activity.js';
import { parseReplyHandlingPolicy, type ProcessInboundMessageResult, type SyncMailboxResult } from './types.js';

export class InboxSyncService {
  private readonly classifier: ReplyClassifier;

  constructor(aiProvider: AIProvider) {
    this.classifier = new ReplyClassifier(aiProvider);
  }

  async processInboundMessage(
    workspaceId: string,
    mailboxId: string,
    message: InboundMessage,
  ): Promise<ProcessInboundMessageResult> {
    const dedupe = await checkMessageDuplicate({
      workspaceId,
      providerMessageId: message.providerMessageId,
      internetMessageId: message.internetMessageId,
    });

    if (dedupe.duplicate && dedupe.existingConversationId && dedupe.existingMessageId) {
      return {
        conversationId: dedupe.existingConversationId,
        messageId: dedupe.existingMessageId,
        duplicate: true,
        classification: null,
        matchStatus: 'MATCHED',
      };
    }

    const leadMatch = await matchLeadByEmail({
      workspaceId,
      fromEmail: message.from.email,
    });

    const campaignMatch = await matchCampaignContext({
      workspaceId,
      mailboxId,
      leadId: leadMatch.leadId,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });

    const thread = await resolveConversationThread({
      workspaceId,
      mailboxId,
      fromEmail: message.from.email,
      subject: message.subject,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });

    const matchStatus =
      campaignMatch.matchStatus === 'MATCHED' && leadMatch.matched
        ? 'MATCHED'
        : leadMatch.matched || campaignMatch.campaignId
          ? 'PARTIAL'
          : 'UNMATCHED';

    const conversation = await conversationService.findOrCreate({
      workspaceId,
      mailboxId,
      conversationId: thread.conversationId,
      leadId: leadMatch.leadId,
      campaignId: campaignMatch.campaignId,
      campaignLeadId: campaignMatch.campaignLeadId,
      subject: message.subject,
      matchStatus,
      receivedAt: message.receivedAt,
    });

    let replyHandlingPolicy: unknown = parseReplyHandlingPolicy(undefined);
    if (campaignMatch.campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignMatch.campaignId },
        select: { replyHandlingPolicy: true },
      });
      replyHandlingPolicy = campaign?.replyHandlingPolicy;
    }

    const classification = await this.classifier.classify({
      messageId: message.providerMessageId,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      rawHeaders: message.rawHeaders,
      detectUnsubscribeEnabled: parseReplyHandlingPolicy(replyHandlingPolicy).detectUnsubscribe,
    });

    const storedMessage = await messageService.createInboundMessage({
      workspaceId,
      mailboxId,
      conversationId: conversation.id,
      message,
      emailMessageId: campaignMatch.emailMessageId,
      classification: classification.classification,
    });

    await conversationService.updateAfterInbound(conversation.id, workspaceId, {
      receivedAt: message.receivedAt,
      classification: classification.classification,
      classificationSource: classification.source,
      classificationConfidence: classification.confidence,
      classificationSummary: classification.summary,
      suggestedAction: classification.suggestedAction,
      leadId: leadMatch.leadId,
      campaignId: campaignMatch.campaignId,
      campaignLeadId: campaignMatch.campaignLeadId,
      matchStatus,
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: conversation.id,
        workspaceId,
        type: 'CLASSIFIED',
        summary: `Reply classified as ${classification.classification}`,
        metadata: {
          classification: classification.classification,
          source: classification.source,
          confidence: classification.confidence,
        },
      },
    });

    await applyReplyActions({
      workspaceId,
      conversationId: conversation.id,
      campaignId: campaignMatch.campaignId,
      campaignLeadId: campaignMatch.campaignLeadId,
      leadId: leadMatch.leadId,
      mailboxId,
      inboundMessageId: message.providerMessageId,
      fromEmail: message.from.email,
      classification: classification.classification,
      replyHandlingPolicy,
    });

    if (leadMatch.leadId) {
      await prisma.lead.update({
        where: { id: leadMatch.leadId },
        data: {
          status: classification.classification === 'UNSUBSCRIBE' ? 'UNSUBSCRIBED' : 'REPLIED',
        },
      });
    }

    return {
      conversationId: conversation.id,
      messageId: storedMessage.id,
      duplicate: false,
      classification: classification.classification,
      matchStatus,
    };
  }

  async syncMailbox(
    mailboxId: string,
    workspaceId: string,
    encryptionKey: string,
    options?: { limit?: number },
  ): Promise<SyncMailboxResult> {
    const start = Date.now();
    const result: SyncMailboxResult = {
      fetched: 0,
      processed: 0,
      duplicates: 0,
      errors: 0,
    };

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId, inboundEnabled: true },
      include: {
        credential: true,
        inboundConfig: true,
        syncState: true,
      },
    });

    if (!mailbox?.inboundConfig?.enabled || !mailbox.credential) {
      throw new Error('Mailbox inbound sync is not configured');
    }

    const { inboundConfig, credential, syncState } = mailbox;
    if (!inboundConfig.imapHost || !inboundConfig.imapPort) {
      throw new Error('Mailbox is missing IMAP configuration');
    }

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { inboundStatus: 'SYNCING' },
    });

    const password = decryptSecret(credential.encryptedPayload, encryptionKey);
    const folders = parseSyncFolders(inboundConfig.syncFolders);
    const provider = createImapInboundProvider({
      host: inboundConfig.imapHost,
      port: inboundConfig.imapPort,
      username: inboundConfig.imapUsername ?? mailbox.emailAddress,
      password,
      encryption: inboundConfig.encryptionType,
      folders,
    });

    const cursor = buildCursor(syncState);
    let latestCursor = cursor;

    try {
      for (const folder of folders) {
        const fetchResult = await provider.fetchMessages({
          cursor: { ...latestCursor, folder },
          limit: options?.limit ?? 50,
        });

        result.fetched += fetchResult.fetchedCount;
        latestCursor = fetchResult.cursor;

        for (const message of fetchResult.messages) {
          try {
            const processed = await this.processInboundMessage(workspaceId, mailboxId, message);
            if (processed.duplicate) {
              result.duplicates += 1;
            } else {
              result.processed += 1;
            }
          } catch (error) {
            result.errors += 1;
            logInboxEvent('Failed to process inbound message', {
              workspaceId,
              mailboxId,
              error: error instanceof Error ? error.message : 'unknown',
              status: 'process_error',
            });
          }
        }
      }

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.mailboxSyncState.upsert({
          where: { mailboxId },
          create: {
            workspaceId,
            mailboxId,
            provider: 'IMAP',
            status: 'CONNECTED',
            lastSyncAt: now,
            lastSuccessAt: now,
            lastMessageUid: latestCursor.lastMessageUid ?? null,
            cursor: latestCursor as unknown as Prisma.InputJsonValue,
          },
          update: {
            status: 'CONNECTED',
            lastSyncAt: now,
            lastSuccessAt: now,
            lastMessageUid: latestCursor.lastMessageUid ?? null,
            cursor: latestCursor as unknown as Prisma.InputJsonValue,
            lastError: null,
            errorCategory: null,
          },
        });

        await tx.mailbox.update({
          where: { id: mailboxId },
          data: {
            inboundStatus: 'CONNECTED',
            lastInboundSyncAt: now,
            lastInboundError: null,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inbound sync failed';
      await prisma.mailbox.update({
        where: { id: mailboxId },
        data: {
          inboundStatus: 'ERROR',
          lastInboundError: message,
          lastInboundSyncAt: new Date(),
        },
      });
      await prisma.mailboxSyncState.upsert({
        where: { mailboxId },
        create: {
          workspaceId,
          mailboxId,
          provider: 'IMAP',
          status: 'ERROR',
          lastError: message,
          lastSyncAt: new Date(),
        },
        update: {
          status: 'ERROR',
          lastError: message,
          lastSyncAt: new Date(),
        },
      });
      throw error;
    } finally {
      logInboxEvent('Mailbox inbound sync completed', {
        workspaceId,
        mailboxId,
        fetched: result.fetched,
        processed: result.processed,
        durationMs: Date.now() - start,
        status: result.errors > 0 ? 'completed_with_errors' : 'completed',
      });
    }

    return result;
  }
}

function parseSyncFolders(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return ['INBOX'];
}

function buildCursor(syncState: { lastMessageUid: number | null; cursor: unknown } | null): SyncCursor {
  if (!syncState) return {};
  const stored = syncState.cursor;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const cursor = stored as SyncCursor;
    return {
      folder: cursor.folder ?? 'INBOX',
      lastMessageUid: syncState.lastMessageUid ?? cursor.lastMessageUid ?? null,
    };
  }
  return { lastMessageUid: syncState.lastMessageUid ?? null, folder: 'INBOX' };
}

export function createInboxSyncService(aiProvider: AIProvider): InboxSyncService {
  return new InboxSyncService(aiProvider);
}
