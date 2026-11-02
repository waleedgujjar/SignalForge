import { describe, expect, it } from 'vitest';
import { classifySendError, retryBackoffMs } from './error-classifier.js';

describe('classifySendError', () => {
  it('classifies auth failures', () => {
    const result = classifySendError(new Error('535 Authentication failed'));
    expect(result.category).toBe('AUTH');
    expect(result.retryable).toBe(false);
  });

  it('classifies rate limit errors as retryable', () => {
    const result = classifySendError('421 Too many messages');
    expect(result.category).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('classifies connection timeouts as retryable', () => {
    const result = classifySendError(new Error('ETIMEDOUT connecting to smtp.example.com'));
    expect(result.category).toBe('CONNECTION');
    expect(result.retryable).toBe(true);
  });

  it('classifies 550 bounces as permanent', () => {
    const result = classifySendError('550 mailbox unavailable');
    expect(result.category).toBe('INVALID_ADDRESS');
    expect(result.retryable).toBe(false);
  });

  it('falls back to PERMANENT for 5xx', () => {
    const result = classifySendError('Server said 554 rejected');
    expect(result.category).toBe('PERMANENT');
    expect(result.retryable).toBe(false);
  });

  it('falls back to TEMPORARY for 4xx', () => {
    const result = classifySendError('Server said 452 not now');
    expect(result.category).toBe('TEMPORARY');
    expect(result.retryable).toBe(true);
  });

  it('falls back to UNKNOWN for unclassified errors', () => {
    const result = classifySendError('mysterious failure');
    expect(result.category).toBe('UNKNOWN');
    expect(result.retryable).toBe(true);
  });
});

describe('classifySendError — real-world replies', () => {
  function smtpError(code: number, response: string, transportCode = 'EENVELOPE') {
    return Object.assign(new Error(`Can't send mail - all recipients were rejected: ${response}`), {
      code: transportCode,
      responseCode: code,
      response,
    });
  }

  it.each([
    [smtpError(550, '550-5.1.1 The email account that you tried to reach does not exist.'), 'INVALID_ADDRESS', false],
    [smtpError(550, '550 5.7.26 This mail is unauthenticated, which poses a security risk to the sender'), 'AUTH', false],
    [smtpError(550, '550 5.7.1 Message rejected as spam'), 'PERMANENT', false],
    [smtpError(552, '552 5.2.2 The email account that you tried to reach is over quota'), 'BOUNCE', true],
    [smtpError(550, '550 5.4.5 Daily user sending quota exceeded'), 'RATE_LIMIT', true],
    [smtpError(421, '421 4.7.0 Try again later, closing connection'), 'RATE_LIMIT', true],
    [smtpError(450, '450 4.2.1 The user you are trying to contact is receiving mail too quickly'), 'RATE_LIMIT', true],
    [smtpError(451, '451 4.3.0 Temporary server error'), 'TEMPORARY', true],
    [Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }), 'AUTH', false],
    [Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }), 'CONNECTION', true],
  ] as const)('%#: %s', (error, category, retryable) => {
    expect(classifySendError(error)).toMatchObject({ category, retryable });
  });

  it('does not read numbers inside ids or durations as reply codes', () => {
    expect(classifySendError('Queued as 15302ABC after 550ms').category).toBe('UNKNOWN');
  });
});

describe('retryBackoffMs', () => {
  it('grows with attempts', () => {
    const a1 = retryBackoffMs(1);
    const a2 = retryBackoffMs(2);
    const a3 = retryBackoffMs(3);
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeGreaterThan(a2);
  });

  it('caps at the last table value for high attempts', () => {
    const capped = retryBackoffMs(100);
    expect(capped).toBe(60 * 60_000);
  });
});
