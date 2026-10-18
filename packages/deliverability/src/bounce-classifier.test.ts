import { describe, expect, it } from 'vitest';

import {
  classifyBounce,
  classifyBounceFromCategory,
  extractSmtpResponse,
} from './bounce-classifier.js';

describe('extractSmtpResponse', () => {
  it('pulls the basic and enhanced status codes out of a provider response', () => {
    const details = extractSmtpResponse(
      new Error('550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown'),
    );

    expect(details.statusCode).toBe('550');
    expect(details.enhancedStatusCode).toBe('5.1.1');
    expect(details.response).toContain('Recipient address rejected');
  });

  it('handles non-Error input without throwing', () => {
    expect(extractSmtpResponse('421 4.7.0 Try again later').statusCode).toBe('421');
    expect(extractSmtpResponse(undefined).response).toBe('Unknown send error');
  });

  it('truncates very long provider responses', () => {
    const details = extractSmtpResponse(new Error('x'.repeat(5000)));
    expect(details.response).toHaveLength(1000);
  });
});

describe('classifyBounce', () => {
  it('treats an unknown-user rejection as a hard bounce', () => {
    const result = classifyBounce(new Error('550 5.1.1 User unknown'));
    expect(result.bounceType).toBe('HARD');
    expect(result.isBounce).toBe(true);
  });

  it('treats a full mailbox as a soft bounce even with a 5yz code', () => {
    const result = classifyBounce(new Error('552 5.2.2 Mailbox full'));
    expect(result.bounceType).toBe('SOFT');
    expect(result.isBounce).toBe(true);
  });

  it('treats greylisting as a soft bounce', () => {
    expect(classifyBounce(new Error('451 4.7.1 Greylisted, try again later')).bounceType).toBe(
      'SOFT',
    );
  });

  it('falls back to the enhanced status class when no phrase matches', () => {
    expect(classifyBounce(new Error('5.7.1 Message refused')).bounceType).toBe('HARD');
    expect(classifyBounce(new Error('4.4.2 Connection dropped')).bounceType).toBe('SOFT');
  });

  it('falls back to the basic reply code when there is no enhanced code', () => {
    expect(classifyBounce(new Error('550 Message refused')).bounceType).toBe('HARD');
    expect(classifyBounce(new Error('450 Please retry')).bounceType).toBe('SOFT');
  });

  it('does not classify our own auth and connection failures as bounces', () => {
    for (const message of [
      '535 Authentication failed',
      'connect ECONNREFUSED 10.0.0.1:587',
      'Error: ETIMEDOUT',
      'unable to verify the first certificate',
    ]) {
      const result = classifyBounce(new Error(message));
      expect(result.isBounce, message).toBe(false);
      expect(result.bounceType, message).toBeNull();
    }
  });

  it('leaves an unrecognizable response unclassified rather than guessing', () => {
    const result = classifyBounce(new Error('something went wrong'));
    expect(result.isBounce).toBe(false);
    expect(result.bounceType).toBeNull();
  });
});

describe('classifyBounceFromCategory', () => {
  it('always treats INVALID_ADDRESS as a hard bounce', () => {
    const result = classifyBounceFromCategory('INVALID_ADDRESS', new Error('no details'));
    expect(result.bounceType).toBe('HARD');
    expect(result.isBounce).toBe(true);
  });

  it('downgrades an unclassifiable BOUNCE to soft so a real address is not suppressed', () => {
    const result = classifyBounceFromCategory('BOUNCE', new Error('delivery problem'));
    expect(result.bounceType).toBe('SOFT');
    expect(result.isBounce).toBe(true);
  });

  it('keeps a clear hard bounce hard when the category is BOUNCE', () => {
    const result = classifyBounceFromCategory('BOUNCE', new Error('550 5.1.1 no such user'));
    expect(result.bounceType).toBe('HARD');
  });

  it('leaves auth failures alone regardless of category', () => {
    const result = classifyBounceFromCategory('AUTH_FAILED', new Error('535 Authentication failed'));
    expect(result.isBounce).toBe(false);
  });
});
