export interface WarmupLogFields {
  workspaceId?: string;
  mailboxId?: string;
  configId?: string;
  jobId?: string;
  recipientId?: string;
  status?: string;
  reason?: string;
  outcome?: string;
  error?: string;
  durationMs?: number;
  slotIndex?: number;
  currentLimit?: number;
  attemptedCount?: number;
  sentCount?: number;
  failedCount?: number;
  deferredCount?: number;
}

export function logWarmupEvent(message: string, fields: WarmupLogFields = {}): void {
  const payload = {
    message,
    module: 'warmup',
    timestamp: new Date().toISOString(),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
