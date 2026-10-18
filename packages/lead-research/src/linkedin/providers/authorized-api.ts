/// Descriptor only. LinkedIn's official APIs require a partner agreement that
/// SignalForge does not hold, so this provider is declared — it appears in
/// settings as "Not implemented" so the architecture is visibly ready for a
/// licensed integration — but no adapter ships. Nothing here ever runs.

import type { ProviderDescriptor } from '../types.js';

export const AUTHORIZED_API_DESCRIPTOR: ProviderDescriptor = {
  provider: 'authorized-api',
  displayName: 'LinkedIn authorized API',
  implemented: false,
  configured: false,
  note: 'Requires LinkedIn partner API agreement',
};
