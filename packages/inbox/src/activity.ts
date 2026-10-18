export interface InboxLogFields {
  workspaceId?: string;
  mailboxId?: string;
  conversationId?: string;
  messageId?: string;
  syncJobId?: string;
  status?: string;
  reason?: string;
  classification?: string;
  error?: string;
  durationMs?: number;
  fetched?: number;
  processed?: number;
}

export function logInboxEvent(message: string, fields: InboxLogFields = {}): void {
  const payload = {
    message,
    module: 'inbox',
    timestamp: new Date().toISOString(),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
