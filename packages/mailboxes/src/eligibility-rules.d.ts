import type { EligibilityContext, EligibilityResult } from './types.js';
export interface MailboxLike {
    status: string;
    healthStatus: string;
    dailySendingLimit: number;
    currentDailyUsage: number;
    verifiedAt: Date | null;
    smtpHost: string | null;
    smtpPort: number | null;
}
export declare function evaluateMailboxEligibility(mailbox: MailboxLike & {
    credential?: unknown;
}, _context?: EligibilityContext): EligibilityResult;
//# sourceMappingURL=eligibility-rules.d.ts.map