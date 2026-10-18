import { prisma } from '@signalforge/database';
import { deliverabilityPolicyService } from './policy-service.js';
import { normalizeEmail } from './recipient-bounce-service.js';
import type { DeliverabilityBlockReason } from './types.js';

export interface DeliverabilityGateResult {
  allowed: boolean;
  reason: DeliverabilityBlockReason | null;
  message: string | null;
}

const ALLOWED: DeliverabilityGateResult = { allowed: true, reason: null, message: null };

/**
 * Server-side deliverability checks layered on top of the Module 9 eligibility
 * rules. Kept separate from the send pipeline so the API, scheduler, and worker
 * all reach the same verdict from one implementation.
 */
export class DeliverabilitySendGate {
  /// Blocks sends from a mailbox whose protection state says it is unsafe.
  async checkMailbox(workspaceId: string, mailboxId: string): Promise<DeliverabilityGateResult> {
    const { protection } = await deliverabilityPolicyService.get(workspaceId);
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      select: {
        status: true,
        health: { select: { protectionLevel: true, protectionReason: true } },
      },
    });
    if (!mailbox) return ALLOWED;

    if (mailbox.status === 'DISABLED') {
      return {
        allowed: false,
        reason: 'MAILBOX_PAUSED',
        message: mailbox.health?.protectionReason ?? 'Mailbox is paused.',
      };
    }

    if (mailbox.health?.protectionLevel === 'CRITICAL' && protection.reduceSendingOnCritical) {
      return {
        allowed: false,
        reason: 'MAILBOX_CRITICAL_HEALTH',
        message: mailbox.health.protectionReason ?? 'Mailbox health is critical.',
      };
    }

    return ALLOWED;
  }

  /// Blocks sends to a recipient with a suppressing bounce history. Hard bounces
  /// are already enforced through the Suppression table; this additionally
  /// covers recipients escalated by repeated soft failures.
  async checkRecipient(workspaceId: string, email: string): Promise<DeliverabilityGateResult> {
    const { protection } = await deliverabilityPolicyService.get(workspaceId);
    const state = await prisma.recipientBounceState.findUnique({
      where: { workspaceId_email: { workspaceId, email: normalizeEmail(email) } },
      select: { status: true, softBounceCount: true, hardBounceCount: true },
    });
    if (!state) return ALLOWED;

    if (state.status === 'SUPPRESSED') {
      return {
        allowed: false,
        reason: 'RECIPIENT_SUPPRESSED',
        message: `Recipient suppressed after ${state.hardBounceCount} hard and ${state.softBounceCount} soft bounce(s).`,
      };
    }

    if (state.status === 'AT_RISK' && protection.blockRecipientsAtRisk) {
      return {
        allowed: false,
        reason: 'RECIPIENT_SOFT_BOUNCE_AT_RISK',
        message: `Recipient has ${state.softBounceCount} recent soft bounce(s) and is held back from further sends.`,
      };
    }

    return ALLOWED;
  }

  async check(input: {
    workspaceId: string;
    mailboxId?: string | null;
    email?: string | null;
  }): Promise<DeliverabilityGateResult> {
    if (input.email) {
      const recipient = await this.checkRecipient(input.workspaceId, input.email);
      if (!recipient.allowed) return recipient;
    }
    if (input.mailboxId) {
      const mailbox = await this.checkMailbox(input.workspaceId, input.mailboxId);
      if (!mailbox.allowed) return mailbox;
    }
    return ALLOWED;
  }
}

export const deliverabilitySendGate = new DeliverabilitySendGate();
