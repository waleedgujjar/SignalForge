export type {
  InboundProviderName,
  EmailAddress,
  AttachmentMetadata,
  InboundMessage,
  ImapInboundConfig,
  SyncCursor,
  FetchMessagesInput,
  FetchMessagesResult,
  ConnectionTestResult,
  InboundErrorCategory,
  InboundProvider,
  StoredMailboxInboundContext,
} from './types.js';

export {
  stripMessageId,
  parseReferences,
  normalizeAddressObject,
  normalizeParsedMail,
  normalizeSubject,
} from './normalizer.js';

export { ImapInboundProvider } from './imap-provider.js';

export { createInboundProvider, createImapInboundProvider } from './factory.js';

export {
  testImapConnection,
  InboundConnectionTestService,
  type TestImapConnectionInput,
  type ConnectionTestInput,
  type ConnectionTestOutcome,
} from './connection-test.js';
