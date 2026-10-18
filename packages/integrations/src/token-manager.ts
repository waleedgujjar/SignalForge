import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IntegrationTokens, IntegrationProviderAdapter } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function deriveKey(encryptionKey: string): Buffer {
  return Buffer.from(encryptionKey.slice(0, 32).padEnd(32, '0'));
}

export function encryptTokens(
  tokens: IntegrationTokens,
  encryptionKey: string,
): { encryptedPayload: string; keyVersion: number } {
  const plaintext = JSON.stringify(tokens);
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return { encryptedPayload: payload, keyVersion: 1 };
}

export function decryptTokens(
  encryptedPayload: string,
  encryptionKey: string,
): IntegrationTokens {
  const key = deriveKey(encryptionKey);
  const buffer = Buffer.from(encryptedPayload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as IntegrationTokens;
}

export async function getValidTokens(
  encryptedPayload: string,
  encryptionKey: string,
  adapter: IntegrationProviderAdapter,
): Promise<{ tokens: IntegrationTokens; refreshed: boolean }> {
  const tokens = decryptTokens(encryptedPayload, encryptionKey);

  if (tokens.expiresAt - Date.now() > REFRESH_THRESHOLD_MS) {
    return { tokens, refreshed: false };
  }

  const refreshed = await adapter.refreshTokens(tokens);
  return { tokens: refreshed, refreshed: true };
}
