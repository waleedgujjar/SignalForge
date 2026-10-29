import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@signalforge/config';

// Short-lived bearer token so the browser can send large uploads DIRECTLY to the
// API origin (bypassing the Vercel rewrite proxy, which drops big request bodies
// with a 502). The session cookie lives on the web app's domain and cannot cross
// origins, so uploads authenticate with this HMAC-signed token instead.

export interface UploadTokenPayload {
  userId: string;
  workspaceId: string;
  role: string;
  scope: 'upload';
  exp: number;
}

export const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

export function signUploadToken(input: { userId: string; workspaceId: string; role: string }): {
  token: string;
  expiresAt: string;
} {
  const env = loadEnv();
  const exp = Date.now() + UPLOAD_TOKEN_TTL_MS;
  const payload = JSON.stringify({
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: input.role,
    scope: 'upload',
    exp,
  } satisfies UploadTokenPayload);
  const sig = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('hex');
  return {
    token: `${Buffer.from(payload).toString('base64url')}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const env = loadEnv();
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, 'base64url').toString();
  const expected = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('hex');
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'hex');
  } catch {
    return null;
  }
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(payload) as UploadTokenPayload;
    if (data.scope !== 'upload') return null;
    if (!data.exp || data.exp < Date.now()) return null;
    if (!data.userId || !data.workspaceId) return null;
    return data;
  } catch {
    return null;
  }
}
