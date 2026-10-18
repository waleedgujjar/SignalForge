import { z } from 'zod';
import type {
  ClassificationSource,
  ConversationMatchStatus,
  ConversationStatus,
  InboundSyncStatus,
  InboxSyncJobStatus,
  MessageDirection,
  ReplyClassification,
} from '@signalforge/database';

export type {
  ClassificationSource,
  ConversationMatchStatus,
  ConversationStatus,
  InboundSyncStatus,
  InboxSyncJobStatus,
  MessageDirection,
  ReplyClassification,
};

export const replyHandlingPolicySchema = z.object({
  pauseOnReply: z.boolean().default(false),
  stopOnReply: z.boolean().default(true),
  autoArchiveOoo: z.boolean().default(false),
  detectUnsubscribe: z.boolean().default(true),
});

export type ReplyHandlingPolicy = z.infer<typeof replyHandlingPolicySchema>;

export const DEFAULT_REPLY_HANDLING_POLICY: ReplyHandlingPolicy = {
  pauseOnReply: false,
  stopOnReply: true,
  autoArchiveOoo: false,
  detectUnsubscribe: true,
};

export interface InboxSyncQueuePayload {
  inboxSyncJobId: string;
  workspaceId: string;
  mailboxId: string;
}

export interface ProcessInboundMessageInput {
  workspaceId: string;
  mailboxId: string;
  message: import('@signalforge/inbound').InboundMessage;
}

export interface ProcessInboundMessageResult {
  conversationId: string;
  messageId: string;
  duplicate: boolean;
  classification: ReplyClassification | null;
  matchStatus: ConversationMatchStatus;
}

export interface ClassificationResult {
  classification: ReplyClassification;
  source: ClassificationSource;
  confidence: number;
  summary: string;
  suggestedAction?: string | null;
}

export interface CampaignMatchResult {
  campaignId: string | null;
  campaignLeadId: string | null;
  emailMessageId: string | null;
  matchStatus: ConversationMatchStatus;
}

export interface LeadMatchResult {
  leadId: string | null;
  matched: boolean;
}

export interface ThreadResolutionResult {
  conversationId: string | null;
  matchedBy: 'IN_REPLY_TO' | 'REFERENCES' | 'SUBJECT' | 'NONE';
}

export interface InboxStats {
  totalConversations: number;
  openConversations: number;
  needsResponse: number;
  unreadCount: number;
  byClassification: Partial<Record<ReplyClassification, number>>;
  byStatus: Partial<Record<ConversationStatus, number>>;
}

export interface ComposeReplyInput {
  conversationId: string;
  workspaceId: string;
  tone?: 'professional' | 'friendly' | 'concise';
}

export interface ComposeReplyResult {
  subject: string;
  body: string;
  tone: 'professional' | 'friendly' | 'concise';
}

export interface SendReplyInput {
  conversationId: string;
  workspaceId: string;
  subject: string;
  body: string;
  htmlBody?: string;
  ccRecipients?: Array<{ email: string; name?: string | null }>;
  bccRecipients?: Array<{ email: string; name?: string | null }>;
}

export interface SendReplyResult {
  conversationMessageId: string;
  queueJobId?: string;
}

export interface SyncMailboxResult {
  fetched: number;
  processed: number;
  duplicates: number;
  errors: number;
}

export interface InboxSchedulerTickResult {
  scheduled: number;
  dispatched: number;
  deferred: number;
  errors: number;
}

export function parseReplyHandlingPolicy(value: unknown): ReplyHandlingPolicy {
  const parsed = replyHandlingPolicySchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  return DEFAULT_REPLY_HANDLING_POLICY;
}
