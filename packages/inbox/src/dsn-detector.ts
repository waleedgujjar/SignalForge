/// Detecting and parsing Delivery Status Notifications (bounce-backs).
///
/// SMTP acceptance at send time only catches synchronous rejections. Most hard
/// bounces arrive minutes or hours later as an asynchronous DSN (RFC 3464) from
/// the receiving side's mailer-daemon. The inbox sync reads these like any other
/// message, so we detect them here and turn them into real bounce signals
/// instead of treating them as replies.

import type { InboundMessage } from '@signalforge/inbound';

export interface DsnRecipient {
  email: string;
  /// Enhanced status, e.g. "5.1.1".
  statusCode: string | null;
  /// Basic SMTP reply code, e.g. "550".
  smtpCode: string | null;
  diagnostic: string | null;
  bounceType: 'HARD' | 'SOFT';
}

const DSN_SUBJECT =
  /undeliverable|undelivered mail|returned to sender|delivery (?:status notification|has failed|failure)|failure notice|mail delivery (?:failed|subsystem)|delivery incomplete/i;
const MAILER_DAEMON = /^(?:mailer-daemon|postmaster|no-?reply)@/i;
const DSN_BODY_HINT =
  /this is the mail system|delivery to the following recipient(?:s)? failed|could not be delivered|your message (?:was not|wasn't) delivered|message could not be delivered/i;

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return '';
  const value = headers[key];
  return Array.isArray(value) ? value.join(' ') : (value ?? '');
}

/// True when a fetched message is a bounce/delivery-status report rather than a
/// human reply.
export function isDeliveryStatusNotification(message: InboundMessage): boolean {
  const contentType = headerValue(message.rawHeaders, 'content-type').toLowerCase();
  if (contentType.includes('report-type=delivery-status') || contentType.includes('multipart/report')) {
    return true;
  }
  const from = (message.from?.email ?? '').toLowerCase();
  const subject = message.subject ?? '';
  if (MAILER_DAEMON.test(from) && DSN_SUBJECT.test(subject)) return true;
  // Some servers omit the standard content-type; fall back to subject + body shape.
  if (DSN_SUBJECT.test(subject) && DSN_BODY_HINT.test(message.textBody ?? '')) return true;
  return false;
}

function classifyDsn(statusCode: string | null, smtpCode: string | null, diagnostic: string | null): 'HARD' | 'SOFT' {
  const cls = statusCode?.[0] ?? smtpCode?.[0] ?? '5';
  if (cls === '4') return 'SOFT';
  const text = `${statusCode ?? ''} ${diagnostic ?? ''}`.toLowerCase();
  // 4.x is transient; a handful of 5.x conditions are really temporary too.
  if (/mailbox full|over.?quota|quota exceeded|insufficient (?:system )?storage|try again|temporar|rate limit|greylist/i.test(text)) {
    return 'SOFT';
  }
  return 'HARD';
}

/// Extracts the failed recipient(s) and status from a DSN. The machine-readable
/// `message/delivery-status` part is normally inlined in the text body.
export function parseDsn(message: InboundMessage): DsnRecipient[] {
  const body = message.textBody ?? '';
  const statusCode = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(body)?.[1] ?? null;
  const diagnostic = /^Diagnostic-Code:\s*(.+)$/im.exec(body)?.[1]?.trim()?.slice(0, 300) ?? null;
  const smtpCode =
    diagnostic?.match(/\b([45]\d{2})\b/)?.[1] ?? body.match(/\b([45]\d{2})\s+[245]\.\d/)?.[1] ?? null;
  const bounceType = classifyDsn(statusCode, smtpCode, diagnostic);

  const recipients: DsnRecipient[] = [];
  const seen = new Set<string>();
  const finalRecipient = /^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s;<>]+@[^\s;<>]+)>?/gim;
  let match: RegExpExecArray | null;
  while ((match = finalRecipient.exec(body))) {
    const email = match[1]!.toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      recipients.push({ email, statusCode, smtpCode, diagnostic, bounceType });
    }
  }

  // Fallback for non-standard DSNs: find a recipient address near "to:"/"recipient".
  if (recipients.length === 0) {
    const addr = /(?:to|recipient)[:\s<]+([^\s<>]+@[^\s<>]+)/i.exec(body)?.[1];
    if (addr) {
      const email = addr.toLowerCase().replace(/[<>.,;]+$/, '');
      recipients.push({ email, statusCode, smtpCode, diagnostic, bounceType });
    }
  }

  return recipients;
}
