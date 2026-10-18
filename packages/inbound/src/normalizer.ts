import type { AddressObject, Attachment, ParsedMail } from 'mailparser';
import type { AttachmentMetadata, EmailAddress, InboundMessage } from './types.js';

const MESSAGE_ID_PATTERN = /^<(.+)>$/;

export function stripMessageId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = MESSAGE_ID_PATTERN.exec(trimmed);
  return (match?.[1] ?? trimmed).trim().toLowerCase();
}

export function parseReferences(value: string | string[] | undefined | null): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(' ') : value;
  return raw
    .split(/\s+/)
    .map((part) => stripMessageId(part))
    .filter((part): part is string => Boolean(part));
}

export function normalizeAddressObject(input: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!input) return [];
  const entries = Array.isArray(input) ? input : [input];
  const addresses: EmailAddress[] = [];

  for (const entry of entries) {
    for (const addr of entry.value) {
      if (!addr.address) continue;
      addresses.push({
        email: addr.address.trim().toLowerCase(),
        name: addr.name ?? null,
      });
    }
  }

  return addresses;
}

function normalizeAttachment(attachment: Attachment): AttachmentMetadata {
  return {
    filename: attachment.filename ?? 'attachment',
    contentType: attachment.contentType ?? 'application/octet-stream',
    size: attachment.size ?? 0,
    contentId: attachment.contentId ?? null,
  };
}

function normalizeHeaders(parsed: ParsedMail): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  if (!parsed.headers) return headers;

  for (const [key, value] of parsed.headers) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      headers[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      headers[key] = value.map(String);
      continue;
    }
    if (typeof value === 'object' && 'text' in value) {
      headers[key] = String((value as { text?: string }).text ?? value);
    }
  }

  return headers;
}

export function normalizeParsedMail(
  parsed: ParsedMail,
  providerMessageId: string,
): InboundMessage {
  const fromList = normalizeAddressObject(parsed.from);
  const from = fromList[0] ?? { email: 'unknown@invalid', name: null };

  return {
    providerMessageId,
    internetMessageId: stripMessageId(parsed.messageId),
    inReplyTo: stripMessageId(parsed.inReplyTo),
    references: parseReferences(parsed.references),
    from,
    to: normalizeAddressObject(parsed.to),
    cc: normalizeAddressObject(parsed.cc),
    bcc: normalizeAddressObject(parsed.bcc),
    subject: parsed.subject?.trim() || null,
    textBody: typeof parsed.text === 'string' ? parsed.text.trim() || null : null,
    htmlBody: typeof parsed.html === 'string' ? parsed.html.trim() || null : null,
    receivedAt: parsed.date ?? new Date(),
    attachments: (parsed.attachments ?? []).map(normalizeAttachment),
    rawHeaders: normalizeHeaders(parsed),
  };
}

export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return '';
  return subject
    .replace(/^(re|fwd|fw):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
