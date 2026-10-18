import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from './encryption.js';

describe('credential encryption', () => {
  const key = 'test-encryption-key-with-minimum-length';

  it('encrypts and decrypts secrets', () => {
    const { encryptedPayload } = encryptSecret('smtp-password-123', key);
    expect(encryptedPayload).not.toContain('smtp-password-123');
    expect(decryptSecret(encryptedPayload, key)).toBe('smtp-password-123');
  });
});
