import { prisma } from '@signalforge/database';
import { decryptSecret } from '@signalforge/email';
import { createImapInboundProvider } from './factory.js';
import type { ConnectionTestResult, ImapInboundConfig } from './types.js';

export type TestImapConnectionInput = ImapInboundConfig;

export async function testImapConnection(input: TestImapConnectionInput): Promise<ConnectionTestResult> {
  const provider = createImapInboundProvider(input);
  return provider.verifyConnection();
}

export class InboundConnectionTestService {
  constructor(private readonly encryptionKey: string) {}

  async testEphemeral(input: TestImapConnectionInput): Promise<ConnectionTestResult> {
    return testImapConnection(input);
  }

  async testStored(
    mailboxId: string,
    workspaceId: string,
  ): Promise<ConnectionTestResult> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: {
        credential: true,
        inboundConfig: true,
      },
    });

    if (!mailbox) {
      throw new Error('Mailbox not found');
    }

    if (!mailbox.inboundConfig || !mailbox.credential) {
      return {
        success: false,
        message: 'Mailbox is missing inbound configuration or credentials.',
        errorCategory: 'UNKNOWN',
        metadata: { mailboxId },
      };
    }

    const { inboundConfig, credential } = mailbox;
    if (!inboundConfig.imapHost || !inboundConfig.imapPort) {
      return {
        success: false,
        message: 'Mailbox is missing IMAP host or port.',
        errorCategory: 'UNKNOWN',
        metadata: { mailboxId },
      };
    }

    const password = decryptSecret(credential.encryptedPayload, this.encryptionKey);
    const outcome = await testImapConnection({
      host: inboundConfig.imapHost,
      port: inboundConfig.imapPort,
      username: inboundConfig.imapUsername ?? mailbox.emailAddress,
      password,
      encryption: inboundConfig.encryptionType,
      folders: parseSyncFolders(inboundConfig.syncFolders),
    });

    await this.recordOutcome(mailboxId, workspaceId, outcome);
    return outcome;
  }

  private async recordOutcome(
    mailboxId: string,
    workspaceId: string,
    outcome: ConnectionTestResult,
  ): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.mailboxSyncState.upsert({
        where: { mailboxId },
        create: {
          workspaceId,
          mailboxId,
          provider: 'IMAP',
          status: outcome.success ? 'CONNECTED' : 'ERROR',
          lastError: outcome.success ? null : outcome.message,
          errorCategory: outcome.errorCategory ?? null,
          lastSyncAt: now,
          lastSuccessAt: outcome.success ? now : null,
        },
        update: {
          status: outcome.success ? 'CONNECTED' : 'ERROR',
          lastError: outcome.success ? null : outcome.message,
          errorCategory: outcome.errorCategory ?? null,
          lastSyncAt: now,
          ...(outcome.success ? { lastSuccessAt: now } : {}),
        },
      });

      await tx.mailbox.update({
        where: { id: mailboxId },
        data: {
          inboundStatus: outcome.success ? 'CONNECTED' : 'ERROR',
          lastInboundError: outcome.success ? null : outcome.message,
          lastInboundSyncAt: now,
        },
      });
    });
  }
}

function parseSyncFolders(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return ['INBOX'];
}

export type ConnectionTestInput = TestImapConnectionInput;
export type ConnectionTestOutcome = ConnectionTestResult;
