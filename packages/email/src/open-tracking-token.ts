import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Open-tracking pixel token. The tracking id is an opaque random value generated
 * per sent email (never a DB id or email address). The URL carries
 * `<trackingId>.<sig>`; the HMAC signature prevents forgery and id enumeration,
 * so the pixel endpoint only ever acts on ids it actually issued.
 */
export function generateOpenTrackingToken(trackingId: string, secret: string): string {
  return `${trackingId}.${sign(trackingId, secret)}`;
}

export function verifyOpenTrackingToken(token: string, secret: string): { trackingId: string } | null {
  const idx = token.lastIndexOf('.');
  if (idx <= 0 || idx >= token.length - 1) return null;
  const trackingId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(trackingId, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  return { trackingId };
}

export function buildTrackingPixelUrl(apiUrl: string, trackingId: string, secret: string): string {
  return `${apiUrl}/tracking/open.gif?t=${generateOpenTrackingToken(trackingId, secret)}`;
}
