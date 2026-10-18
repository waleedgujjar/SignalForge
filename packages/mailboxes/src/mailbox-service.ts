import { prisma } from '@signalforge/database';
import type { MailboxProvider, MailboxStatus, SmtpEncryption } from '@signalforge/database';
import { encryptSecret } from '@signalforge/email';
import { logMailboxActivity } from './activity.js';

export interface CreateMailboxInput {
  workspaceId: string;
  provider: MailboxProvider;
  name?: string | null;
  emailAddress: string;
  fromName: string;
  replyTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  encryptionType: SmtpEncryption;
  dailySendingLimit: number;
  timezone?: string | null;
  verified?: boolean;
  actorUserId?: string | null;
}

export interface UpdateMailboxInput {
  provider?: MailboxProvider;
  name?: string | null;
  emailAddress?: string;
  fromName?: string;
  replyTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  encryptionType?: SmtpEncryption;
  dailySendingLimit?: number;
  timezone?: string | null;
  status?: MailboxStatus;
  actorUserId?: string | null;
}

export class MailboxService {
  constructor(private readonly encryptionKey: string) {}

  async create(input: CreateMailboxInput) {
    const now = new Date();
    const verified = input.verified === true;

    const mailbox = await prisma.mailbox.create({
      data: {
        workspaceId: input.workspaceId,
        provider: input.provider,
        name: input.name ?? null,
        emailAddress: input.emailAddress,
        fromName: input.fromName,
        replyTo: input.replyTo ?? null,
        smtpHost: input.smtpHost ?? null,
        smtpPort: input.smtpPort ?? null,
        smtpUsername: input.smtpUsername ?? input.emailAddress,
        encryptionType: input.encryptionType,
        dailySendingLimit: input.dailySendingLimit,
        timezone: input.timezone ?? null,
        status: verified ? 'ACTIVE' : 'UNVERIFIED',
        healthStatus: verified ? 'HEALTHY' : 'UNKNOWN',
        verifiedAt: verified ? now : null,
        lastTestedAt: verified ? now : null,
        health: { create: {} },
        ...(input.smtpPassword
          ? {
              credential: {
                create: encryptSecret(input.smtpPassword, this.encryptionKey),
              },
            }
          : {}),
      },
      include: this.includeAll(),
    });

    await logMailboxActivity({
      mailboxId: mailbox.id,
      workspaceId: mailbox.workspaceId,
      type: 'CREATED',
      summary: `Account ${mailbox.emailAddress} created.`,
      actorUserId: input.actorUserId ?? null,
      metadata: { provider: mailbox.provider, verified },
    });

    return mailbox;
  }

  async update(id: string, workspaceId: string, input: UpdateMailboxInput) {
    const existing = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!existing) return null;

    const mailbox = await prisma.mailbox.update({
      where: { id },
      data: {
        ...(input.provider && { provider: input.provider }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.emailAddress && { emailAddress: input.emailAddress }),
        ...(input.fromName && { fromName: input.fromName }),
        ...(input.replyTo !== undefined && { replyTo: input.replyTo }),
        ...(input.smtpHost !== undefined && { smtpHost: input.smtpHost }),
        ...(input.smtpPort !== undefined && { smtpPort: input.smtpPort }),
        ...(input.smtpUsername !== undefined && { smtpUsername: input.smtpUsername }),
        ...(input.encryptionType && { encryptionType: input.encryptionType }),
        ...(input.dailySendingLimit !== undefined && { dailySendingLimit: input.dailySendingLimit }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.status && { status: input.status }),
      },
      include: this.includeAll(),
    });

    if (input.smtpPassword) {
      const encrypted = encryptSecret(input.smtpPassword, this.encryptionKey);
      await prisma.mailboxCredential.upsert({
        where: { mailboxId: id },
        create: { mailboxId: id, ...encrypted },
        update: encrypted,
      });
      await logMailboxActivity({
        mailboxId: id,
        workspaceId,
        type: 'PASSWORD_UPDATED',
        summary: 'SMTP password updated.',
        actorUserId: input.actorUserId ?? null,
      });
    }

    await logMailboxActivity({
      mailboxId: id,
      workspaceId,
      type: 'UPDATED',
      summary: `Account ${mailbox.emailAddress} updated.`,
      actorUserId: input.actorUserId ?? null,
      metadata: this.updatedFields(input),
    });

    return mailbox;
  }

  async enable(id: string, workspaceId: string, actorUserId?: string | null) {
    const existing = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!existing) return null;
    if (!existing.verifiedAt) {
      throw new Error('Account must pass a connection test before it can be enabled.');
    }

    const mailbox = await prisma.mailbox.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: this.includeAll(),
    });

    await logMailboxActivity({
      mailboxId: id,
      workspaceId,
      type: 'ENABLED',
      summary: 'Account enabled.',
      actorUserId: actorUserId ?? null,
    });
    return mailbox;
  }

  async disable(id: string, workspaceId: string, actorUserId?: string | null) {
    const existing = await prisma.mailbox.findFirst({ where: { id, workspaceId } });
    if (!existing) return null;

    const mailbox = await prisma.mailbox.update({
      where: { id },
      data: { status: 'DISABLED' },
      include: this.includeAll(),
    });

    await logMailboxActivity({
      mailboxId: id,
      workspaceId,
      type: 'DISABLED',
      summary: 'Account disabled.',
      actorUserId: actorUserId ?? null,
    });
    return mailbox;
  }

  async delete(id: string, workspaceId: string, actorUserId?: string | null) {
    const existing = await prisma.mailbox.findFirst({
      where: { id, workspaceId },
      include: { campaigns: { include: { campaign: true } } },
    });
    if (!existing) return { deleted: false as const };

    const activeCampaigns = existing.campaigns.filter((c) =>
      ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(c.campaign.status),
    );

    await logMailboxActivity({
      mailboxId: id,
      workspaceId,
      type: 'DELETED',
      summary: `Account ${existing.emailAddress} deleted.`,
      actorUserId: actorUserId ?? null,
      metadata: { activeCampaigns: activeCampaigns.length },
    });

    await prisma.mailbox.delete({ where: { id } });
    return { deleted: true as const, activeCampaigns: activeCampaigns.length };
  }

  private includeAll() {
    return {
      campaigns: { include: { campaign: true } },
      health: true,
      credential: false,
    } as const;
  }

  private updatedFields(input: UpdateMailboxInput): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(input) as Array<keyof UpdateMailboxInput>) {
      if (key === 'smtpPassword' || key === 'actorUserId') continue;
      if (input[key] !== undefined) fields[key] = input[key];
    }
    return fields;
  }
}
