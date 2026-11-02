import { describe, expect, it } from 'vitest';
import type { InboundMessage } from '@signalforge/inbound';
import { isDeliveryStatusNotification, parseDsn } from './dsn-detector.js';

function message(overrides: Partial<InboundMessage>): InboundMessage {
  return {
    providerMessageId: 'uid-1',
    internetMessageId: '<x@mx>',
    inReplyTo: null,
    references: [],
    from: { email: 'someone@example.com', name: null },
    to: [],
    cc: [],
    bcc: [],
    subject: null,
    textBody: null,
    htmlBody: null,
    receivedAt: new Date(),
    attachments: [],
    rawHeaders: {},
    ...overrides,
  };
}

const HARD_DSN = `This is the mail system at host mx1.hostinger.com.

I'm sorry to have to inform you that your message could not be delivered to one
or more recipients.

Reporting-MTA: dns; mx1.hostinger.com
Final-Recipient: rfc822; nobody@invalid-domain.test
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <nobody@invalid-domain.test>: Recipient address rejected: User unknown`;

const SOFT_DSN = `Final-Recipient: rfc822; busy@example.com
Action: failed
Status: 4.2.2
Diagnostic-Code: smtp; 452 4.2.2 Mailbox full`;

describe('isDeliveryStatusNotification', () => {
  it('detects by multipart/report content-type', () => {
    expect(
      isDeliveryStatusNotification(
        message({ rawHeaders: { 'Content-Type': 'multipart/report; report-type=delivery-status; boundary=x' } }),
      ),
    ).toBe(true);
  });

  it('detects by mailer-daemon sender + subject', () => {
    expect(
      isDeliveryStatusNotification(
        message({ from: { email: 'MAILER-DAEMON@hostinger.com', name: null }, subject: 'Undelivered Mail Returned to Sender' }),
      ),
    ).toBe(true);
  });

  it('detects by subject + body shape when headers are plain', () => {
    expect(
      isDeliveryStatusNotification(message({ subject: 'Mail delivery failed', textBody: HARD_DSN })),
    ).toBe(true);
  });

  it('does not flag an ordinary reply', () => {
    expect(
      isDeliveryStatusNotification(
        message({ from: { email: 'lead@acme.com', name: 'Lead' }, subject: 'Re: your email', textBody: 'Sounds good!' }),
      ),
    ).toBe(false);
  });
});

describe('parseDsn', () => {
  it('parses a hard bounce: recipient, codes, HARD', () => {
    const [r, ...rest] = parseDsn(message({ textBody: HARD_DSN }));
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({
      email: 'nobody@invalid-domain.test',
      statusCode: '5.1.1',
      smtpCode: '550',
      bounceType: 'HARD',
    });
  });

  it('classifies a mailbox-full 4.x as SOFT', () => {
    const [r] = parseDsn(message({ textBody: SOFT_DSN }));
    expect(r).toMatchObject({ email: 'busy@example.com', statusCode: '4.2.2', bounceType: 'SOFT' });
  });

  it('returns nothing when no recipient can be extracted', () => {
    expect(parseDsn(message({ textBody: 'This is the mail system. Delivery failed.' }))).toHaveLength(0);
  });
});
