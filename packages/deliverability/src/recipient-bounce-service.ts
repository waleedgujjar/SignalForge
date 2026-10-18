import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';
import { deliverabilityPolicyService } from './policy-service.js';
import type { BounceType, DeliverabilityThresholds, RecipientBounceStatus } from './types.js';

export interface RecordBounceInput {
  workspaceId: string;
  email: string;
  bounceType: BounceType;
  smtpStatusCode?: string | null;
  response?: string | null;
  occurredAt?: Date;
}

export interface RecordBounceResult {
  status: RecipientBounceStatus;
  softBounceCount: number;
  hardBounceCount: number;
  /// True when this bounce pushed the recipient across the suppression threshold.
  shouldSuppress: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decides a recipient's bounce status from its counters.
 *
 * Hard bounces are permanent, so a single one suppresses. Soft bounces escalate:
 * `softBounceThreshold` marks the recipient AT_RISK (surfaced in the UI and
 * optionally blocked), and `softBounceSuppressThreshold` suppresses after
 * repeated temporary failures so we stop retrying a dead address forever.
 */
export function evaluateRecipientStatus(
  counters: { softBounceCount: number; hardBounceCount: number },
  thresholds: Pick<DeliverabilityThresholds, 'softBounceThreshold' | 'softBounceSuppressThreshold'>,
): RecipientBounceStatus {
  if (counters.hardBounceCount > 0) return 'SUPPRESSED';
  if (
    thresholds.softBounceSuppressThreshold > 0 &&
    counters.softBounceCount >= thresholds.softBounceSuppressThreshold
  ) {
    return 'SUPPRESSED';
  }
  if (counters.softBounceCount >= thresholds.softBounceThreshold) return 'AT_RISK';
  return 'ACTIVE';
}

export class RecipientBounceService {
  async recordBounce(
    input: RecordBounceInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<RecordBounceResult> {
    const { thresholds } = await deliverabilityPolicyService.get(input.workspaceId);
    const email = normalizeEmail(input.email);
    const occurredAt = input.occurredAt ?? new Date();
    const isHard = input.bounceType === 'HARD';

    const existing = await client.recipientBounceState.findUnique({
      where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
    });

    const softBounceCount = (existing?.softBounceCount ?? 0) + (isHard ? 0 : 1);
    const hardBounceCount = (existing?.hardBounceCount ?? 0) + (isHard ? 1 : 0);
    const status = evaluateRecipientStatus({ softBounceCount, hardBounceCount }, thresholds);

    await client.recipientBounceState.upsert({
      where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
      create: {
        workspaceId: input.workspaceId,
        email,
        lastBounceType: input.bounceType,
        bounceCount: 1,
        softBounceCount,
        hardBounceCount,
        status,
        lastSmtpCode: input.smtpStatusCode ?? null,
        lastResponse: input.response?.slice(0, 1000) ?? null,
        firstBounceAt: occurredAt,
        lastBounceAt: occurredAt,
      },
      update: {
        lastBounceType: input.bounceType,
        bounceCount: { increment: 1 },
        softBounceCount,
        hardBounceCount,
        status,
        lastSmtpCode: input.smtpStatusCode ?? null,
        lastResponse: input.response?.slice(0, 1000) ?? null,
        lastBounceAt: occurredAt,
      },
    });

    return {
      status,
      softBounceCount,
      hardBounceCount,
      shouldSuppress: status === 'SUPPRESSED',
    };
  }

  async getState(workspaceId: string, email: string) {
    return prisma.recipientBounceState.findUnique({
      where: { workspaceId_email: { workspaceId, email: normalizeEmail(email) } },
    });
  }

  /// Clears bounce history for a recipient. Used when an operator has verified
  /// the address is valid again; hard-bounce suppressions remain enforced by
  /// the Suppression table until removed there too.
  async reset(workspaceId: string, email: string): Promise<void> {
    await prisma.recipientBounceState.deleteMany({
      where: { workspaceId, email: normalizeEmail(email) },
    });
  }
}

export const recipientBounceService = new RecipientBounceService();
