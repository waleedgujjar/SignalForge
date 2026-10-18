import { prisma } from '@signalforge/database';
import type { Prisma, SmtpEncryption } from '@signalforge/database';
import { createSmtpProvider, decryptSecret } from '@signalforge/email';
import { logMailboxActivity } from './activity.js';
import type { ConnectionTestInput, ConnectionTestOutcome } from './types.js';

export class MailboxConnectionService {
  constructor(private readonly encryptionKey: string) {}

  async testEphemeral(input: ConnectionTestInput): Promise<ConnectionTestOutcome> {
    const provider = createSmtpProvider({
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      encryption: input.encryption,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
    });

    const result = await provider.verifyConnection();
    return {
      success: result.success,
      errorCategory: result.errorCategory,
      message: result.success
        ? 'SMTP connection successful.'
        : result.message ?? 'SMTP connection failed.',
      metadata: {
        host: input.host,
        port: input.port,
        encryption: input.encryption,
      },
    };
  }

  async testStored(
    mailboxId: string,
    workspaceId: string,
    options?: { actorUserId?: string | null },
  ): Promise<ConnectionTestOutcome> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: { credential: true },
    });

    if (!mailbox) {
      throw new Error('Mailbox not found');
    }

    if (
      !mailbox.credential ||
      !mailbox.smtpHost ||
      !mailbox.smtpPort ||
      !mailbox.encryptionType
    ) {
      const outcome: ConnectionTestOutcome = {
        success: false,
        errorCategory: 'UNKNOWN',
        message: 'Mailbox is missing SMTP configuration.',
        metadata: {
          host: mailbox.smtpHost ?? '',
          port: mailbox.smtpPort ?? 0,
          encryption: (mailbox.encryptionType ?? 'TLS') as SmtpEncryption,
        },
      };
      await this.recordTest(mailbox.id, workspaceId, outcome, options?.actorUserId);
      return outcome;
    }

    const password = decryptSecret(mailbox.credential.encryptedPayload, this.encryptionKey);
    const outcome = await this.testEphemeral({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      username: mailbox.smtpUsername ?? mailbox.emailAddress,
      password,
      encryption: mailbox.encryptionType,
      fromEmail: mailbox.emailAddress,
      fromName: mailbox.fromName,
    });

    await this.recordTest(mailbox.id, workspaceId, outcome, options?.actorUserId);
    return outcome;
  }

  private async recordTest(
    mailboxId: string,
    workspaceId: string,
    outcome: ConnectionTestOutcome,
    actorUserId?: string | null,
  ) {
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.mailboxConnectionTest.create({
        data: {
          mailboxId,
          workspaceId,
          status: outcome.success ? 'SUCCESS' : 'FAILED',
          errorCategory: outcome.errorCategory ?? null,
          summary: outcome.message,
          metadata: outcome.metadata as unknown as Prisma.InputJsonValue,
        },
      });

      if (outcome.success) {
        await tx.mailbox.update({
          where: { id: mailboxId },
          data: {
            lastTestedAt: now,
            verifiedAt: now,
            healthStatus: 'HEALTHY',
            status: 'ACTIVE',
            lastErrorAt: null,
            lastErrorMessage: null,
          },
        });
      } else {
        await tx.mailbox.update({
          where: { id: mailboxId },
          data: {
            lastTestedAt: now,
            healthStatus: 'UNHEALTHY',
            status: 'ERROR',
            lastErrorAt: now,
            lastErrorMessage: outcome.message,
          },
        });
      }
    });

    await logMailboxActivity({
      mailboxId,
      workspaceId,
      type: outcome.success ? 'VERIFIED' : 'TESTED',
      summary: outcome.success ? 'SMTP connection verified.' : 'SMTP connection test failed.',
      actorUserId: actorUserId ?? null,
      metadata: {
        host: outcome.metadata.host,
        port: outcome.metadata.port,
        encryption: outcome.metadata.encryption,
        errorCategory: outcome.errorCategory,
      },
    });
  }
}
