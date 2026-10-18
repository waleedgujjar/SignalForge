import { describe, expect, it } from 'vitest';
import { normalizeSmtpError } from './smtp-errors.js';

describe('normalizeSmtpError', () => {
  it('classifies auth failures via error code', () => {
    const result = normalizeSmtpError({ code: 'EAUTH', message: 'Invalid login' });
    expect(result.category).toBe('AUTH_FAILED');
    expect(result.message).toContain('Authentication failed');
  });

  it('classifies 535 SMTP responses as auth failures', () => {
    const result = normalizeSmtpError({ responseCode: 535, message: '5.7.8 Bad credentials' });
    expect(result.category).toBe('AUTH_FAILED');
  });

  it('classifies connection timeout', () => {
    const result = normalizeSmtpError({ code: 'ETIMEDOUT', message: 'Timed out' });
    expect(result.category).toBe('CONNECTION_TIMEOUT');
  });

  it('classifies connection refused', () => {
    const result = normalizeSmtpError({
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:25',
    });
    expect(result.category).toBe('CONNECTION_REFUSED');
  });

  it('classifies invalid host via DNS failure', () => {
    const result = normalizeSmtpError({
      code: 'ENOTFOUND',
      message: 'getaddrinfo ENOTFOUND smtp.example.com',
    });
    expect(result.category).toBe('INVALID_HOST');
  });

  it('classifies TLS failures', () => {
    const result = normalizeSmtpError({ code: 'ESOCKET', message: 'wrong version number' });
    expect(result.category).toBe('TLS_FAILED');
  });

  it('classifies provider rejection via 5xx response', () => {
    const result = normalizeSmtpError({ responseCode: 550, message: 'Address rejected' });
    expect(result.category).toBe('PROVIDER_REJECTED');
  });

  it('falls back to UNKNOWN for unrecognized errors', () => {
    const result = normalizeSmtpError(new Error('mystery'));
    expect(result.category).toBe('UNKNOWN');
  });

  it('never surfaces the raw SMTP error text', () => {
    const raw = 'password=super-secret-value';
    const result = normalizeSmtpError({ code: 'EAUTH', message: raw });
    expect(result.message).not.toContain(raw);
  });
});
