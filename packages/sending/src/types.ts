import type { SendErrorCategory, SendingJobStatus } from '@signalforge/database';

export type { SendErrorCategory, SendingJobStatus };

export interface SendingScheduleConfig {
  timezone?: string;
  days?: number[];
  startTime?: string;
  endTime?: string;
  minDelayMinutes?: number;
  maxDelayMinutes?: number;
}

export interface ScheduleWindowOptions {
  now: Date;
  config: SendingScheduleConfig;
}

export interface NextSendResult {
  scheduledAt: Date;
  withinWindow: boolean;
  reason?: string;
}

export type SendingJobEligibilityReason =
  | 'ELIGIBLE'
  | 'CAMPAIGN_NOT_ACTIVE'
  | 'CAMPAIGN_LEAD_INACTIVE'
  | 'LEAD_ARCHIVED'
  | 'LEAD_UNSUBSCRIBED'
  | 'LEAD_BOUNCED'
  | 'LEAD_REPLIED'
  | 'LEAD_SUPPRESSED'
  | 'INVALID_EMAIL'
  | 'JOB_ALREADY_TERMINAL'
  | 'CAMPAIGN_DAILY_LIMIT_REACHED'
  | 'MAILBOX_CRITICAL_HEALTH'
  | 'MAILBOX_PAUSED'
  | 'RECIPIENT_SUPPRESSED'
  | 'RECIPIENT_SOFT_BOUNCE_AT_RISK';

export interface SendingJobEligibilityResult {
  eligible: boolean;
  reason: SendingJobEligibilityReason;
  message: string;
}

export interface CampaignLimitContext {
  campaignId: string;
  timezone: string;
  dailyLimit: number | null;
  sentToday: number;
}

export interface SendingJobPayload {
  sendingJobId: string;
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  stepId: string;
}
