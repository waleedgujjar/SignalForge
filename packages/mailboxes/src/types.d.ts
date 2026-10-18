import type { Mailbox, MailboxCredential, MailboxHealth, MailboxStatus, HealthStatus, SmtpEncryption, MailboxProvider, SmtpErrorCategory, MailboxConnectionTestStatus, MailboxActivityType } from '@signalforge/database';
export type { MailboxStatus, HealthStatus, SmtpEncryption, MailboxProvider, SmtpErrorCategory, MailboxConnectionTestStatus, MailboxActivityType, };
export interface MailboxWithRelations extends Mailbox {
    credential?: MailboxCredential | null;
    health?: MailboxHealth | null;
}
export interface EligibilityContext {
    now?: Date;
}
export type EligibilityReason = 'ELIGIBLE' | 'UNVERIFIED' | 'DISABLED' | 'PAUSED' | 'ERROR' | 'DISCONNECTED' | 'UNHEALTHY' | 'DAILY_LIMIT_EXHAUSTED' | 'MISSING_CREDENTIALS';
export interface EligibilityResult {
    eligible: boolean;
    reason: EligibilityReason;
    message: string;
    remainingToday: number;
}
export interface UsageSummary {
    dailySendingLimit: number;
    sentToday: number;
    remainingToday: number;
    usageDate: string;
    timezone: string;
}
export interface ConnectionTestInput {
    host: string;
    port: number;
    username: string;
    password: string;
    encryption: SmtpEncryption;
    fromEmail: string;
    fromName: string;
}
export interface ConnectionTestOutcome {
    success: boolean;
    errorCategory?: SmtpErrorCategory;
    message: string;
    metadata: {
        host: string;
        port: number;
        encryption: SmtpEncryption;
    };
}
//# sourceMappingURL=types.d.ts.map