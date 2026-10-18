import type { AIProvider } from '@signalforge/ai';
import type { ReplyClassification } from '@signalforge/database';
import { detectUnsubscribe } from './unsubscribe-detector.js';
import type { ClassificationResult } from './types.js';

const OOO_PATTERNS = [
  /\bout of office\b/i,
  /\booo\b/i,
  /\baway from (the )?office\b/i,
  /\bon vacation\b/i,
  /\bautomatic reply\b/i,
];

const NOT_INTERESTED_PATTERNS = [
  /\bnot interested\b/i,
  /\bno thank(s| you)\b/i,
  /\bpass for now\b/i,
  /\bnot a fit\b/i,
];

const INTERESTED_PATTERNS = [
  /\binterested\b/i,
  /\blet'?s (talk|chat|connect)\b/i,
  /\bschedule (a )?(call|meeting|demo)\b/i,
  /\bsounds good\b/i,
];

export interface ClassifyReplyInput {
  messageId: string;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  rawHeaders?: Record<string, string | string[]>;
  detectUnsubscribeEnabled?: boolean;
}

export class ReplyClassifier {
  constructor(private readonly aiProvider: AIProvider) {}

  async classify(input: ClassifyReplyInput): Promise<ClassificationResult> {
    const body = [input.textBody, stripHtml(input.htmlBody)].filter(Boolean).join('\n');
    const corpus = [input.subject, body].filter(Boolean).join('\n');

    if (input.detectUnsubscribeEnabled !== false) {
      const unsub = detectUnsubscribe({
        subject: input.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody,
        rawHeaders: input.rawHeaders ?? {},
      });
      if (unsub.detected) {
        return {
          classification: 'UNSUBSCRIBE',
          source: 'SYSTEM',
          confidence: 0.98,
          summary: unsub.matchedPhrase ?? 'Unsubscribe request detected',
          suggestedAction: 'Add lead to suppression list and stop campaign',
        };
      }
    }

    for (const pattern of OOO_PATTERNS) {
      if (pattern.test(corpus)) {
        return {
          classification: 'OUT_OF_OFFICE',
          source: 'SYSTEM',
          confidence: 0.95,
          summary: 'Out-of-office auto reply detected',
          suggestedAction: 'Defer follow-up until return',
        };
      }
    }

    for (const pattern of NOT_INTERESTED_PATTERNS) {
      if (pattern.test(corpus)) {
        return {
          classification: 'NOT_INTERESTED',
          source: 'SYSTEM',
          confidence: 0.9,
          summary: 'Negative intent detected via keyword heuristics',
          suggestedAction: 'Close conversation and pause enrollment',
        };
      }
    }

    for (const pattern of INTERESTED_PATTERNS) {
      if (pattern.test(corpus)) {
        return {
          classification: 'INTERESTED',
          source: 'SYSTEM',
          confidence: 0.88,
          summary: 'Positive intent detected via keyword heuristics',
          suggestedAction: 'Respond promptly and schedule next step',
        };
      }
    }

    if (corpus.includes('?')) {
      return {
        classification: 'QUESTION',
        source: 'SYSTEM',
        confidence: 0.75,
        summary: 'Question detected in reply',
        suggestedAction: 'Provide a direct answer',
      };
    }

    const aiResult = await this.aiProvider.classifyReply({
      messageId: input.messageId,
      body: body || input.subject || '',
    });

    return {
      classification: mapAiCategory(aiResult.category),
      source: 'AI',
      confidence: aiResult.confidence,
      summary: aiResult.summary ?? `AI classified as ${aiResult.category}`,
      suggestedAction:
        aiResult.suggestedAction ?? suggestedActionFor(mapAiCategory(aiResult.category)),
    };
  }
}

function mapAiCategory(
  category: import('@signalforge/ai').ReplyClassificationResult['category'],
): ReplyClassification {
  switch (category) {
    case 'INTERESTED':
      return 'INTERESTED';
    case 'NOT_INTERESTED':
      return 'NOT_INTERESTED';
    case 'QUESTION':
      return 'QUESTION';
    case 'NEEDS_FOLLOW_UP':
      return 'NEEDS_FOLLOW_UP';
    case 'OOO':
      return 'OUT_OF_OFFICE';
    case 'UNSUBSCRIBE':
      return 'UNSUBSCRIBE';
    case 'WRONG_PERSON':
      return 'WRONG_PERSON';
    case 'REFERRAL':
      return 'REFERRAL';
    case 'POSITIVE':
      return 'POSITIVE';
    case 'NEGATIVE':
      return 'NEGATIVE';
    case 'NEUTRAL':
      return 'NEUTRAL';
    default:
      return 'UNKNOWN';
  }
}

function suggestedActionFor(classification: ReplyClassification): string {
  switch (classification) {
    case 'INTERESTED':
      return 'Respond and propose a meeting';
    case 'NOT_INTERESTED':
      return 'Acknowledge and close thread';
    case 'QUESTION':
      return 'Answer the question directly';
    case 'NEEDS_FOLLOW_UP':
      return 'Schedule follow-up';
    case 'OUT_OF_OFFICE':
      return 'Wait for return date';
    case 'UNSUBSCRIBE':
      return 'Suppress lead and stop campaign';
    default:
      return 'Review manually';
  }
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
