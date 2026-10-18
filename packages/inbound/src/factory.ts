import type { InboundProvider, InboundProviderName, ImapInboundConfig } from './types.js';
import { ImapInboundProvider } from './imap-provider.js';

export function createInboundProvider(
  provider: InboundProviderName,
  config: ImapInboundConfig,
): InboundProvider {
  switch (provider) {
    case 'IMAP':
      return new ImapInboundProvider(config);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported inbound provider: ${exhaustive as string}`);
    }
  }
}

export function createImapInboundProvider(config: ImapInboundConfig): InboundProvider {
  return createInboundProvider('IMAP', config);
}
