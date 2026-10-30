import { describe, it, expect } from 'vitest';
import {
  generateOpenTrackingToken,
  verifyOpenTrackingToken,
  buildTrackingPixelUrl,
} from './open-tracking-token.js';

const SECRET = 'test-secret-at-least-32-characters-long';
const TRACKING_ID = '5f3c1b2a-0d4e-4c7a-9b1e-2a6f8c0d1e2f';

describe('open-tracking-token', () => {
  it('generates a token that verifies back to the tracking id', () => {
    const token = generateOpenTrackingToken(TRACKING_ID, SECRET);
    expect(verifyOpenTrackingToken(token, SECRET)).toEqual({ trackingId: TRACKING_ID });
  });

  it('does not expose the tracking id in a way that survives signature tampering', () => {
    const token = generateOpenTrackingToken(TRACKING_ID, SECRET);
    const tampered = `other-id.${token.split('.')[1]}`;
    expect(verifyOpenTrackingToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const token = generateOpenTrackingToken(TRACKING_ID, SECRET);
    expect(verifyOpenTrackingToken(token, 'a-different-secret-value-32-characters')).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyOpenTrackingToken('', SECRET)).toBeNull();
    expect(verifyOpenTrackingToken('no-dot', SECRET)).toBeNull();
    expect(verifyOpenTrackingToken('.onlysig', SECRET)).toBeNull();
    expect(verifyOpenTrackingToken('id.', SECRET)).toBeNull();
  });

  it('builds a pixel URL whose token verifies', () => {
    const url = buildTrackingPixelUrl('https://api.example.com', TRACKING_ID, SECRET);
    expect(url).toMatch(/^https:\/\/api\.example\.com\/tracking\/open\.gif\?t=.+$/);
    const token = new URL(url).searchParams.get('t')!;
    expect(verifyOpenTrackingToken(token, SECRET)).toEqual({ trackingId: TRACKING_ID });
  });
});
