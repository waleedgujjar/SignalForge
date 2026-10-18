import type { InboundMessage } from '@signalforge/inbound';

export interface UnsubscribeDetectionResult {
  detected: boolean;
  reason?: 'KEYWORD' | 'LIST_UNSUBSCRIBE' | 'AUTO_SUBMITTED';
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

export function detectUnsubscribe(
  message: Pick<InboundMessage, 'textBody' | 'htmlBody' | 'subject' | 'rawHeaders'>,
): UnsubscribeDetectionResult {
  const listUnsubscribe = message.rawHeaders['list-unsubscribe'];
  if (listUnsubscribe) {
    return { detected: true, reason: 'LIST_UNSUBSCRIBE', matchedPhrase: 'List-Unsubscribe header' };
  }

  const autoSubmitted = message.rawHeaders['auto-submitted'];
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') {
    const autoValue = String(autoSubmitted).toLowerCase();
    if (autoValue.includes('auto-replied')) {
      return { detected: false, reason: 'AUTO_SUBMITTED' };
    }
  }

  const corpus = [message.subject, message.textBody, stripHtml(message.htmlBody)]
    .filter(Boolean)
    .join('\n');

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

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
