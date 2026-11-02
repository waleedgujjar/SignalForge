import type { InboundMessage } from '@signalforge/inbound';

export interface UnsubscribeDetectionResult {
  detected: boolean;
  reason?: 'KEYWORD' | 'AUTO_SUBMITTED';
  matchedPhrase?: string;
}

const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\bstop emailing\b/i,
  /\bstop sending\b/i,
  /\bdo not contact\b/i,
  /\btake me off\b/i,
  /\bno longer interested\b/i,
];

/**
 * Detects a request to stop receiving email in a reply.
 *
 * Only the text the person wrote is checked, never the quoted original: our
 * outgoing emails carry an unsubscribe footer, so scanning the quote would
 * flag every reply. A List-Unsubscribe header on an inbound message is not a
 * request either; it only means the message came from a mailing system.
 */
export function detectUnsubscribe(
  message: Pick<InboundMessage, 'textBody' | 'htmlBody' | 'subject' | 'rawHeaders'>,
): UnsubscribeDetectionResult {
  const autoSubmitted = message.rawHeaders['auto-submitted'];
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') {
    const autoValue = String(autoSubmitted).toLowerCase();
    if (autoValue.includes('auto-replied')) {
      return { detected: false, reason: 'AUTO_SUBMITTED' };
    }
  }

  const body = message.textBody
    ? newReplyText(message.textBody)
    : stripHtml(newReplyHtml(message.htmlBody));
  const corpus = [message.subject, body].filter(Boolean).join('\n');

  for (const pattern of UNSUBSCRIBE_PATTERNS) {
    const match = pattern.exec(corpus);
    if (match) {
      return {
        detected: true,
        reason: 'KEYWORD',
        matchedPhrase: match[0],
      };
    }
  }

  return { detected: false };
}

// Where a reply's quoted history begins, across common clients.
const QUOTE_HEADERS = [
  /^\s*On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:\s*$/im, // Gmail / Apple Mail (may wrap)
  /^\s*-{2,}\s*Original Message\s*-{2,}/im, // Outlook
  /^\s*_{5,}\s*$/m, // Outlook separator line
  /^\s*From:\s.+\n\s*(?:Sent|Date):\s/im, // Outlook header block
  /^\s*Le\b[^\n]{0,300}a écrit\s*:\s*$/im, // French Gmail
  /^\s*Am\b[^\n]{0,300}schrieb[^\n]*:\s*$/im, // German Gmail
];

/** The part of a plain-text reply above the quoted original. */
export function newReplyText(text: string): string {
  let cut = text.length;
  for (const pattern of QUOTE_HEADERS) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text
    .slice(0, cut)
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
}

function newReplyHtml(html: string | null | undefined): string {
  if (!html) return '';
  const markers = [/<blockquote\b/i, /class=["'][^"']*gmail_quote/i, /id=["']?(?:appendonsend|divRplyFwdMsg)/i];
  let cut = html.length;
  for (const marker of markers) {
    const match = marker.exec(html);
    if (match && match.index < cut) cut = match.index;
  }
  return html.slice(0, cut);
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
