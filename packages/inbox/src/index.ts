export type {
  ClassificationSource,
  ConversationMatchStatus,
  ConversationStatus,
  InboundSyncStatus,
  InboxSyncJobStatus,
  MessageDirection,
  ReplyClassification,
  ReplyHandlingPolicy,
  InboxSyncQueuePayload,
  ProcessInboundMessageInput,
  ProcessInboundMessageResult,
  ClassificationResult,
  CampaignMatchResult,
  LeadMatchResult,
  ThreadResolutionResult,
  InboxStats,
  ComposeReplyInput,
  ComposeReplyResult,
  SendReplyInput,
  SendReplyResult,
  SyncMailboxResult,
  InboxSchedulerTickResult,
} from './types.js';

export {
  replyHandlingPolicySchema,
  DEFAULT_REPLY_HANDLING_POLICY,
  parseReplyHandlingPolicy,
} from './types.js';

export { logInboxEvent, type InboxLogFields } from './activity.js';

export { checkMessageDuplicate, type DeduplicationCheckInput, type DeduplicationCheckResult } from './deduplication.js';

export { resolveConversationThread, type ResolveThreadInput } from './thread-resolver.js';

export {
  matchLeadByEmail,
  matchLeadByDomain,
  type MatchLeadInput,
} from './lead-matcher.js';

export { matchCampaignContext, type MatchCampaignInput } from './campaign-matcher.js';

export { detectUnsubscribe, type UnsubscribeDetectionResult } from './unsubscribe-detector.js';

export { ReplyClassifier, type ClassifyReplyInput } from './reply-classifier.js';

export { applyReplyActions, mapReplyToStopReason, type ApplyReplyActionsInput, type ApplyReplyActionsResult } from './reply-actions.js';

export {
  ConversationService,
  conversationService,
  type FindOrCreateConversationInput,
} from './conversation-service.js';

export {
  MessageService,
  messageService,
  type CreateInboundMessageInput,
} from './message-service.js';

export { NoteService, noteService, type CreateNoteInput, type UpdateNoteInput } from './note-service.js';

export { InboxSyncService, createInboxSyncService } from './sync-service.js';

export { ReplyComposer, createReplyComposer } from './reply-composer.js';

export { SendReplyService, createSendReplyService } from './send-reply-service.js';

export { StatsService, statsService } from './stats-service.js';

export { InboxSchedulerService, createInboxSchedulerService } from './scheduler.js';
