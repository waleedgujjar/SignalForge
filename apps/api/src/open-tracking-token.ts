import { loadEnv } from '@signalforge/config';
import {
  generateOpenTrackingToken as generate,
  verifyOpenTrackingToken as verify,
  buildTrackingPixelUrl as buildUrl,
} from '@signalforge/email';

export function generateOpenTrackingToken(trackingId: string): string {
  return generate(trackingId, loadEnv().SESSION_SECRET);
}

export function verifyOpenTrackingToken(token: string): { trackingId: string } | null {
  return verify(token, loadEnv().SESSION_SECRET);
}

export function buildTrackingPixelUrl(trackingId: string): string {
  const env = loadEnv();
  return buildUrl(env.API_URL, trackingId, env.SESSION_SECRET);
}
