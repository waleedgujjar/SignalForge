import type { MailboxActivityType, Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';

export async function logMailboxActivity(input: {
  mailboxId: string;
  workspaceId: string;
  type: MailboxActivityType;
  summary: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.mailboxActivity.create({
    data: {
      mailboxId: input.mailboxId,
      workspaceId: input.workspaceId,
      type: input.type,
      summary: input.summary,
      actorUserId: input.actorUserId ?? null,
      metadata: sanitizeMetadata(input.metadata) as Prisma.InputJsonValue,
    },
  });
}

const REDACT_KEYS = new Set(['password', 'smtppassword', 'secret', 'token', 'encryptedpayload']);

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACT_KEYS.has(key.toLowerCase())) continue;
    clean[key] = value;
  }
  return clean;
}
