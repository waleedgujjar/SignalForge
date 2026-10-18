import type { Queue, JobsOptions } from 'bullmq';

export interface InboxReplyQueuePayload {
  conversationMessageId: string;
  workspaceId: string;
  mailboxId: string;
  conversationId: string;
}

export const INBOX_REPLY_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2 * 60_000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export async function enqueueInboxReply(
  queue: Queue<InboxReplyQueuePayload>,
  payload: InboxReplyQueuePayload,
  options?: { delayMs?: number; jobId?: string },
) {
  return queue.add('inbox-reply', payload, {
    ...INBOX_REPLY_JOB_OPTIONS,
    delay: options?.delayMs,
    jobId: options?.jobId ?? `inbox-reply-${payload.conversationMessageId}`,
  });
}
