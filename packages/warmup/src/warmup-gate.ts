/// Deliverability gates for warmup: a mailbox should not warm a domain whose
/// authentication is broken, and should not keep ramping while the mailbox is
/// in a reputation-protection state. Both read existing deliverability data
/// (DomainHealthCheck, MailboxHealth) directly — no new tracking.

import { prisma } from '@signalforge/database';

export interface WarmupHold {
  held: boolean;
  reason?: string;
}

const NOT_HELD: WarmupHold = { held: false };

function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? '').lastIndexOf('@');
  if (at === -1) return null;
  return email!.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Blocks warmup when the sending domain's SPF or DKIM is a definite FAIL/INVALID.
 * UNKNOWN / NOT_CHECKED / no row never blocks — an inconclusive check must not
 * stop a correctly-configured domain (the scheduler auto-checks sending domains).
 */
export async function getDomainAuthHold(workspaceId: string, emailAddress: string): Promise<WarmupHold> {
  const domain = domainOf(emailAddress);
  if (!domain) return NOT_HELD;
  const row = await prisma.domainHealthCheck.findUnique({
    where: { workspaceId_domain: { workspaceId, domain } },
    select: { spfStatus: true, dkimStatus: true },
  });
  if (!row) return NOT_HELD;
  const bad = (s: string) => s === 'FAIL' || s === 'INVALID';
  if (bad(row.dkimStatus)) return { held: true, reason: `DKIM is ${row.dkimStatus} for ${domain} — enable DKIM before warming.` };
  if (bad(row.spfStatus)) return { held: true, reason: `SPF is ${row.spfStatus} for ${domain}.` };
  return NOT_HELD;
}

/**
 * Holds the ramp when the mailbox is in a reputation-protection state
 * (AT_RISK / CRITICAL), which the deliverability engine sets from bounce and
 * complaint rates. This keeps warmup from increasing volume on a mailbox that
 * is already showing deliverability trouble.
 */
export async function getReputationHold(mailboxId: string): Promise<WarmupHold> {
  const health = await prisma.mailboxHealth.findUnique({
    where: { mailboxId },
    select: { protectionLevel: true, protectionReason: true },
  });
  if (health && (health.protectionLevel === 'AT_RISK' || health.protectionLevel === 'CRITICAL')) {
    return { held: true, reason: health.protectionReason ?? `Mailbox protection level is ${health.protectionLevel}.` };
  }
  return NOT_HELD;
}
