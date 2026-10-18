import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedPayload {
  encryptedPayload: string;
  keyVersion: number;
}

export function encryptSecret(plaintext: string, encryptionKey: string, keyVersion = 1): EncryptedPayload {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return { encryptedPayload: payload, keyVersion };
}

export function decryptSecret(encryptedPayload: string, encryptionKey: string): string {
  try {
    return decryptWith(encryptedPayload, deriveKey(encryptionKey));
  } catch {
    return decryptWith(encryptedPayload, deriveKeyLegacy(encryptionKey));
  }
}

function decryptWith(encryptedPayload: string, key: Buffer): string {
  const buffer = Buffer.from(encryptedPayload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function deriveKey(encryptionKey: string): Buffer {
  return createHash('sha256').update(encryptionKey).digest();
}

function deriveKeyLegacy(encryptionKey: string): Buffer {
  return Buffer.from(encryptionKey.slice(0, 32).padEnd(32, '0'));
}
