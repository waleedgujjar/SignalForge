export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;
export type CampaignId = Brand<string, 'CampaignId'>;
export type MailboxId = Brand<string, 'MailboxId'>;
export type LeadId = Brand<string, 'LeadId'>;

export function createId<T extends string>(value: string, _brand: T): Brand<string, T> {
  return value as Brand<string, T>;
}

export interface JobLogContext {
  jobId?: string;
  workspaceId?: string;
  campaignId?: string;
  campaignLeadId?: string;
  mailboxId?: string;
  leadId?: string;
  status?: string;
  blockReason?: string;
  rotationStrategy?: string;
  durationMs?: number;
  error?: string;
  retryCount?: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
