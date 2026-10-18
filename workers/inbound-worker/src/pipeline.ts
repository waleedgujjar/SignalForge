import { createAIProvider } from '@signalforge/ai';
import { loadEnv } from '@signalforge/config';
import { createInboxSyncService, InboxSchedulerService, logInboxEvent } from '@signalforge/inbox';
import type { InboundSyncQueuePayload } from '@signalforge/queue';

export type InboundPipelineOutcome =
  | { ok: true; fetched: number; processed: number; duplicates: number; errors: number }
  | { ok: false; reason: string; retryable?: boolean };

export async function processInboundSyncJob(
  payload: InboundSyncQueuePayload,
  inboxScheduler: InboxSchedulerService,
): Promise<InboundPipelineOutcome> {
  const start = Date.now();
  const env = loadEnv();

  logInboxEvent('Processing inbound sync job', {
    workspaceId: payload.workspaceId,
    mailboxId: payload.mailboxId,
    syncJobId: payload.inboxSyncJobId,
    status: 'processing',
  });

  const aiProvider = createAIProvider(env.AI_PROVIDER, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });
  const syncService = createInboxSyncService(aiProvider);

  try {
    const result = await syncService.syncMailbox(
      payload.mailboxId,
      payload.workspaceId,
      env.ENCRYPTION_KEY,
    );

    await inboxScheduler.completeSyncJob(payload.inboxSyncJobId, result);

    logInboxEvent('Inbound sync job completed', {
      workspaceId: payload.workspaceId,
      mailboxId: payload.mailboxId,
      syncJobId: payload.inboxSyncJobId,
      fetched: result.fetched,
      processed: result.processed,
      status: result.errors > 0 ? 'completed_with_errors' : 'completed',
      durationMs: Date.now() - start,
    });

    return { ok: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inbound sync failed';
    logInboxEvent('Inbound sync job failed', {
      workspaceId: payload.workspaceId,
      mailboxId: payload.mailboxId,
      syncJobId: payload.inboxSyncJobId,
      error: message,
      status: 'failed',
      durationMs: Date.now() - start,
    });
    return { ok: false, reason: message, retryable: true };
  }
}
