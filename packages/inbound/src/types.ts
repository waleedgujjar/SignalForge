import type { SmtpEncryption } from '@signalforge/database';

export type InboundProviderName = 'IMAP';

export interface EmailAddress {
  email: string;
  name?: string | null;
}

export interface AttachmentMetadata {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string | null;
}

export interface InboundMessage {
  providerMessageId: string;
  internetMessageId?: string | null;
  inReplyTo?: string | null;
  references: string[];
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedAt: Date;
  attachments: AttachmentMetadata[];
  rawHeaders: Record<string, string | string[]>;
}

export interface ImapInboundConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: SmtpEncryption;
  folders?: string[];
}

export interface SyncCursor {
  lastMessageUid?: number | null;
  folder?: string | null;
}

export interface FetchMessagesInput {
  cursor: SyncCursor;
  limit?: number;
  since?: Date | null;
}

export interface FetchMessagesResult {
  messages: InboundMessage[];
  cursor: SyncCursor;
  fetchedCount: number;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  errorCategory?: InboundErrorCategory;
  metadata?: Record<string, unknown>;
}

export type InboundErrorCategory =
  | 'AUTH_FAILED'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'TLS_FAILED'
  | 'FOLDER_NOT_FOUND'
  | 'UNKNOWN';

export interface InboundProvider {
  readonly name: InboundProviderName;
  verifyConnection(): Promise<ConnectionTestResult>;
  fetchMessages(input: FetchMessagesInput): Promise<FetchMessagesResult>;
}

export interface StoredMailboxInboundContext {
  mailboxId: string;
  workspaceId: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  encryptionType: SmtpEncryption;
  syncFolders: string[];
}
