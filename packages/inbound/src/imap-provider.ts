import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type {
  ConnectionTestResult,
  FetchMessagesInput,
  FetchMessagesResult,
  ImapInboundConfig,
  InboundErrorCategory,
  InboundMessage,
  InboundProvider,
} from './types.js';
import { normalizeParsedMail } from './normalizer.js';

const DEFAULT_FETCH_LIMIT = 50;

function buildClientConfig(config: ImapInboundConfig) {
  const secure = config.encryption === 'SSL';
  return {
    host: config.host,
    port: config.port,
    secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false as const,
    ...(config.encryption === 'TLS' && !secure ? { tls: { rejectUnauthorized: true } } : {}),
  };
}

function classifyImapError(error: unknown): InboundErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('auth') || message.includes('invalid credentials') || message.includes('login')) {
    return 'AUTH_FAILED';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'CONNECTION_TIMEOUT';
  }
  if (message.includes('econnrefused') || message.includes('connection refused')) {
    return 'CONNECTION_REFUSED';
  }
  if (message.includes('enotfound') || message.includes('getaddrinfo')) {
    return 'INVALID_HOST';
  }
  if (message.includes('tls') || message.includes('certificate')) {
    return 'TLS_FAILED';
  }
  if (message.includes('folder') || message.includes('mailbox')) {
    return 'FOLDER_NOT_FOUND';
  }
  return 'UNKNOWN';
}

export class ImapInboundProvider implements InboundProvider {
  readonly name = 'IMAP' as const;

  constructor(private readonly config: ImapInboundConfig) {}

  async verifyConnection(): Promise<ConnectionTestResult> {
    const client = new ImapFlow(buildClientConfig(this.config));
    try {
      await client.connect();
      const folder = this.config.folders?.[0] ?? 'INBOX';
      const lock = await client.getMailboxLock(folder);
      lock.release();
      await client.logout();
      return {
        success: true,
        message: 'IMAP connection successful.',
        metadata: {
          host: this.config.host,
          port: this.config.port,
          encryption: this.config.encryption,
          folder,
        },
      };
    } catch (error) {
      const category = classifyImapError(error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'IMAP connection failed.',
        errorCategory: category,
        metadata: {
          host: this.config.host,
          port: this.config.port,
          encryption: this.config.encryption,
        },
      };
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      }
    }
  }

  async fetchMessages(input: FetchMessagesInput): Promise<FetchMessagesResult> {
    const folder = input.cursor.folder ?? this.config.folders?.[0] ?? 'INBOX';
    const limit = input.limit ?? DEFAULT_FETCH_LIMIT;
    const client = new ImapFlow(buildClientConfig(this.config));
    const messages: InboundMessage[] = [];
    let highestUid = input.cursor.lastMessageUid ?? 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        const searchCriteria: Record<string, unknown> = {};
        if (input.cursor.lastMessageUid) {
          searchCriteria.uid = `${input.cursor.lastMessageUid + 1}:*`;
        } else if (input.since) {
          searchCriteria.since = input.since;
        }

        const searchResult = await client.search(searchCriteria, { uid: true });
        const uids = Array.isArray(searchResult) ? searchResult : [];
        const sortedUids = [...uids].sort((a, b) => a - b).slice(0, limit);

        for (const uid of sortedUids) {
          const fetched = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
          if (!fetched || !('source' in fetched) || !fetched.source) continue;

          const parsed = await simpleParser(fetched.source);
          const providerMessageId = `${folder}:${uid}`;
          messages.push(normalizeParsedMail(parsed, providerMessageId));
          if (uid > highestUid) highestUid = uid;
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      }
    }

    return {
      messages,
      fetchedCount: messages.length,
      cursor: {
        folder,
        lastMessageUid: highestUid || input.cursor.lastMessageUid,
      },
    };
  }
}
