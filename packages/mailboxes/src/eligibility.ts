import { prisma } from '@signalforge/database';
import { evaluateMailboxEligibility, type MailboxLike } from './eligibility-rules.js';
import type { EligibilityResult } from './types.js';

export { evaluateMailboxEligibility };
export type { MailboxLike };

export class MailboxEligibilityService {
  async isMailboxEligible(mailboxId: string, workspaceId: string): Promise<EligibilityResult> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
    });
    if (!mailbox) {
      return {
        eligible: false,
        reason: 'MISSING_CREDENTIALS',
        message: 'Mailbox not found.',
        remainingToday: 0,
      };
    }
    return evaluateMailboxEligibility(mailbox);
  }

  async filterEligible(mailboxIds: string[], workspaceId: string) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { id: { in: mailboxIds }, workspaceId },
    });
    return mailboxes.map((mailbox) => ({
      mailboxId: mailbox.id,
      ...evaluateMailboxEligibility(mailbox),
    }));
  }
}

export const mailboxEligibilityService = new MailboxEligibilityService();
