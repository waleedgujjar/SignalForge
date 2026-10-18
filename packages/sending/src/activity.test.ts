import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from './activity.js';

describe('sanitizeMetadata', () => {
  it('returns empty object for null/undefined', () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
  });

  it('passes through safe keys', () => {
    const input = { campaignId: 'c1', leadId: 'l1', status: 'sent' };
    expect(sanitizeMetadata(input)).toEqual(input);
  });

  it('strips password key', () => {
    const result = sanitizeMetadata({ password: 'secret123', host: 'smtp.example.com' });
    expect(result).toEqual({ host: 'smtp.example.com' });
    expect(result).not.toHaveProperty('password');
  });

  it('strips smtpPassword key (case insensitive)', () => {
    const result = sanitizeMetadata({ smtpPassword: 'pass', port: 587 });
    expect(result).toEqual({ port: 587 });
  });

  it('strips secret key', () => {
    const result = sanitizeMetadata({ secret: 'xyz', name: 'test' });
    expect(result).toEqual({ name: 'test' });
  });

  it('strips token key', () => {
    const result = sanitizeMetadata({ token: 'abc', mailboxId: 'm1' });
    expect(result).toEqual({ mailboxId: 'm1' });
  });

  it('strips encryptedPayload key', () => {
    const result = sanitizeMetadata({ encryptedPayload: 'encrypted', id: '1' });
    expect(result).toEqual({ id: '1' });
  });

  it('is case-insensitive for redact keys', () => {
    const result = sanitizeMetadata({ PASSWORD: 'x', TOKEN: 'y', name: 'ok' });
    expect(result).toEqual({ name: 'ok' });
  });

  it('handles empty metadata', () => {
    expect(sanitizeMetadata({})).toEqual({});
  });
});
