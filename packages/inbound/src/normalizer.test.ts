import { describe, expect, it } from 'vitest';
import { normalizeParsedMail, normalizeSubject, parseReferences } from './normalizer.js';

describe('normalizeParsedMail', () => {
  it('extracts internet message id and threading headers', () => {
    const normalized = normalizeParsedMail(
      {
        messageId: '<abc@example.com>',
        inReplyTo: '<parent@example.com>',
        references: ['<root@example.com>', '<parent@example.com>'],
        from: { value: [{ address: 'lead@example.com', name: 'Lead' }] },
        to: { value: [{ address: 'sales@example.com', name: 'Sales' }] },
        cc: { value: [] },
        bcc: { value: [] },
        subject: 'Re: Hello',
        text: 'Sounds good.',
        html: '<p>Sounds good.</p>',
        date: new Date('2026-01-05T12:00:00Z'),
        attachments: [],
        headers: new Map(),
      } as never,
      '42',
    );

    expect(normalized.providerMessageId).toBe('42');
    expect(normalized.internetMessageId).toBe('abc@example.com');
    expect(normalized.inReplyTo).toBe('parent@example.com');
    expect(normalized.from.email).toBe('lead@example.com');
    expect(normalized.textBody).toContain('Sounds good');
  });
});

describe('parseReferences', () => {
  it('parses angle-bracket message ids', () => {
    expect(parseReferences('<a@x.com> <b@x.com>')).toEqual(['a@x.com', 'b@x.com']);
  });
});

describe('normalizeSubject', () => {
  it('strips re/fwd prefixes for matching', () => {
    expect(normalizeSubject('Re: Hello there')).toBe('hello there');
  });
});
