import { evaluateMailboxEligibility, type MailboxLike } from '@signalforge/mailboxes';
import type { DegradedMailboxPolicy } from './types.js';

export interface CandidateMailbox extends MailboxLike {
  id: string;
  poolMemberEnabled: boolean;
  priority: number;
  reservedToday: number;
  warmupSentToday: number;
  warmupReservedToday: number;
  credential?: unknown;
}

export interface EligibleCandidate {
  mailboxId: string;
  priority: number;
  dailyLimit: number;
  sentToday: number;
  reservedToday: number;
  warmupSentToday: number;
  warmupReservedToday: number;
  healthStatus: string;
  poolMemberEnabled: boolean;
}

export interface EligibilityFilterResult {
  eligible: EligibleCandidate[];
  rejected: Array<{ mailboxId: string; reason: string; message: string }>;
}

/**
 * Filter candidate mailboxes using Module 8 eligibility rules, augmented with
 * pool-member enabled flags, reservation counts, and workspace degraded policy.
 */
export function filterEligibleAccounts(
  candidates: CandidateMailbox[],
  degradedPolicy: DegradedMailboxPolicy,
): EligibilityFilterResult {
  const eligible: EligibleCandidate[] = [];
  const rejected: EligibilityFilterResult['rejected'] = [];

  for (const candidate of candidates) {
    if (!candidate.poolMemberEnabled) {
      rejected.push({
        mailboxId: candidate.id,
        reason: 'POOL_MEMBER_DISABLED',
        message: 'Pool member is disabled.',
      });
      continue;
    }

    const effectiveSent =
      candidate.currentDailyUsage +
      candidate.reservedToday +
      candidate.warmupSentToday +
      candidate.warmupReservedToday;
    const result = evaluateMailboxEligibility({
      ...candidate,
      currentDailyUsage: effectiveSent,
    });

    if (!result.eligible) {
      rejected.push({ mailboxId: candidate.id, reason: result.reason, message: result.message });
      continue;
    }

    if (degradedPolicy === 'EXCLUDE' && candidate.healthStatus === 'DEGRADED') {
      rejected.push({
        mailboxId: candidate.id,
        reason: 'DEGRADED_EXCLUDED',
        message: 'Workspace policy excludes DEGRADED mailboxes.',
      });
      continue;
    }

    eligible.push({
      mailboxId: candidate.id,
      priority: candidate.priority,
      dailyLimit: candidate.dailySendingLimit,
      sentToday: candidate.currentDailyUsage,
      reservedToday: candidate.reservedToday,
      warmupSentToday: candidate.warmupSentToday,
      warmupReservedToday: candidate.warmupReservedToday,
      healthStatus: candidate.healthStatus,
      poolMemberEnabled: candidate.poolMemberEnabled,
    });
  }

  return { eligible, rejected };
}
