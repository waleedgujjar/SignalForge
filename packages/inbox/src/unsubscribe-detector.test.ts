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

  it('does not treat a List-Unsubscribe header on a reply as a request', () => {
    const result = detectUnsubscribe({
      subject: 'Thanks',
      textBody: 'Got it.',
      htmlBody: null,
      rawHeaders: { 'list-unsubscribe': '<mailto:unsub@example.com>' },
    });
    expect(result.detected).toBe(false);
  });

  it('ignores the unsubscribe footer in the quoted original (Gmail)', () => {
    const result = detectUnsubscribe({
      subject: 'Re: Quick question',
      textBody: [
        'Sounds good, send me the deck.',
        '',
        'On Mon, 3 Nov 2026 at 10:02, Waleed <waleed@excersys.com>',
        'wrote:',
        '> Hi Jane,',
        "> If you'd rather not hear from me again: https://api.test/unsubscribe?token=x",
      ].join('\n'),
      htmlBody: null,
      rawHeaders: {},
    });
    expect(result.detected).toBe(false);
  });

  it('ignores quoted history in Outlook and HTML replies', () => {
    expect(
      detectUnsubscribe({
        subject: 'RE: Quick question',
        textBody: ['Thanks, interested.', '', '-----Original Message-----', 'From: Waleed', 'unsubscribe here'].join('\n'),
        htmlBody: null,
        rawHeaders: {},
      }).detected,
    ).toBe(false);
    expect(
      detectUnsubscribe({
        subject: 'Re: Quick question',
        textBody: null,
        htmlBody: '<div>Yes please</div><div class="gmail_quote"><blockquote>unsubscribe</blockquote></div>',
        rawHeaders: {},
      }).detected,
    ).toBe(false);
  });

  it('still detects a request written above the quote', () => {
    const result = detectUnsubscribe({
      subject: 'Re: Quick question',
      textBody: ['Please remove me from your list.', '', 'On Mon, Waleed wrote:', '> Hi'].join('\n'),
      htmlBody: null,
      rawHeaders: {},
    });
    expect(result).toMatchObject({ detected: true, reason: 'KEYWORD' });
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
