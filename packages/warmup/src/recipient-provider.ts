import { prisma } from '@signalforge/database';

export interface SelectedWarmupRecipient {
  id: string;
  email: string;
  name: string | null;
}

export interface WarmupRecipientProvider {
  select(input: {
    workspaceId: string;
    mailboxId: string;
    excludeEmail: string;
  }): Promise<SelectedWarmupRecipient | null>;
}

/**
 * V1 provider that picks the next authorized recipient using a round-robin
 * cursor persisted on `EmailWarmupConfig.lastRecipientId`. Recipients matching
 * the mailbox's own address are excluded so we never send warmup email to
 * ourselves.
 */
export class UserConfiguredRecipientProvider implements WarmupRecipientProvider {
  async select(input: {
    workspaceId: string;
    mailboxId: string;
    excludeEmail: string;
  }): Promise<SelectedWarmupRecipient | null> {
    const recipients = await prisma.warmupRecipient.findMany({
      where: {
        workspaceId: input.workspaceId,
        enabled: true,
        consentConfirmed: true,
        email: { not: input.excludeEmail },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true },
    });
    if (recipients.length === 0) return null;

    const config = await prisma.emailWarmupConfig.findUnique({
      where: { mailboxId: input.mailboxId },
      select: { lastRecipientId: true },
    });
    const lastId = config?.lastRecipientId ?? null;
    let index = 0;
    if (lastId) {
      const previousIndex = recipients.findIndex((r) => r.id === lastId);
      if (previousIndex >= 0) {
        index = (previousIndex + 1) % recipients.length;
      }
    }
    const selected = recipients[index];
    if (!selected) return null;
    await prisma.emailWarmupConfig.update({
      where: { mailboxId: input.mailboxId },
      data: { lastRecipientId: selected.id },
    });
    return selected;
  }
}

export const defaultRecipientProvider = new UserConfiguredRecipientProvider();
