import { describe, it, expect } from 'vitest';
import { generateUnsubscribeToken, verifyUnsubscribeToken, buildUnsubscribeUrl } from './unsubscribe-token.js';

const SECRET = 'test-secret-at-least-32-characters-long';

describe('unsubscribe-token', () => {
  it('generates a token that can be verified', () => {
    const token = generateUnsubscribeToken('campaign-1', 'lead-1', SECRET);
    const result = verifyUnsubscribeToken(token, SECRET);
    expect(result).toEqual({ campaignId: 'campaign-1', leadId: 'lead-1' });
  });

  it('returns null for invalid token', () => {
    expect(verifyUnsubscribeToken('invalid-token', SECRET)).toBeNull();
  });

  it('returns null for tampered token', () => {
    const token = generateUnsubscribeToken('campaign-1', 'lead-1', SECRET);
    const decoded = Buffer.from(token, 'base64url').toString();
    const tampered = decoded.replace('campaign-1', 'campaign-2');
    const tamperedToken = Buffer.from(tampered).toString('base64url');
    expect(verifyUnsubscribeToken(tamperedToken, SECRET)).toBeNull();
  });

  it('returns null for wrong secret', () => {
    const token = generateUnsubscribeToken('campaign-1', 'lead-1', SECRET);
    expect(verifyUnsubscribeToken(token, 'wrong-secret')).toBeNull();
  });

  it('builds a full unsubscribe URL', () => {
    const url = buildUnsubscribeUrl('https://api.example.com', 'campaign-1', 'lead-1', SECRET);
    expect(url).toMatch(/^https:\/\/api\.example\.com\/unsubscribe\?token=.+$/);

    const token = new URL(url).searchParams.get('token')!;
    const result = verifyUnsubscribeToken(token, SECRET);
    expect(result).toEqual({ campaignId: 'campaign-1', leadId: 'lead-1' });
  });
});
