import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface AuthSession {
  userId: string;
  workspaceId?: string;
}

export interface SessionRecord extends AuthSession {
  token: string;
  expiresAt: Date;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(':');
  if (!salt || !storedHash) return false;
  const hash = scryptSync(password, salt, 64).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
