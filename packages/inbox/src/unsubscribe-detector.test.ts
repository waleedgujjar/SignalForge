import { describe, expect, it } from 'vitest';
import { detectUnsubscribe } from './unsubscribe-detector.js';

describe('detectUnsubscribe', () => {
  it('detects explicit unsubscribe keyword in text body', () => {
    const result = detectUnsubscribe({
      subject: 'Re: Your offer',
      textBody: 'Please unsubscribe me from this list.',
      htmlBody: null,
      rawHeaders: {},
    });
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('KEYWORD');
    expect(result.matchedPhrase).toMatch(/unsubscribe/i);
  });

  it('detects opt-out phrasing', () => {
    const result = detectUnsubscribe({
      subject: null,
      textBody: 'I would like to opt out of future emails.',
      htmlBody: null,
      rawHeaders: {},
    });
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('KEYWORD');
  });

  it('detects remove me and stop emailing phrases', () => {
    expect(
      detectUnsubscribe({
        subject: null,
        textBody: 'Remove me from your mailing list.',
        htmlBody: null,
        rawHeaders: {},
      }).detected,
    ).toBe(true);

    expect(
      detectUnsubscribe({
        subject: 'Stop emailing me',
        textBody: null,
        htmlBody: null,
        rawHeaders: {},
      }).detected,
    ).toBe(true);
  });

  it('detects List-Unsubscribe header without body keywords', () => {
    const result = detectUnsubscribe({
      subject: 'Thanks',
      textBody: 'Got it.',
      htmlBody: null,
      rawHeaders: { 'list-unsubscribe': '<mailto:unsub@example.com>' },
    });
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('LIST_UNSUBSCRIBE');
    expect(result.matchedPhrase).toBe('List-Unsubscribe header');
  });

  it('does not flag auto-replied messages as unsubscribe', () => {
    const result = detectUnsubscribe({
      subject: 'Out of office',
      textBody: 'I am away.',
      htmlBody: null,
      rawHeaders: { 'auto-submitted': 'auto-replied' },
    });
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('AUTO_SUBMITTED');
  });

  it('returns not detected for normal replies', () => {
    const result = detectUnsubscribe({
      subject: 'Re: Demo request',
      textBody: 'Yes, I am interested. Can we schedule a call?',
      htmlBody: null,
      rawHeaders: {},
    });
    expect(result.detected).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('scans stripped html body for unsubscribe phrases', () => {
    const result = detectUnsubscribe({
      subject: null,
      textBody: null,
      htmlBody: '<p>Please <strong>take me off</strong> this list.</p>',
      rawHeaders: {},
    });
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('KEYWORD');
  });
});
