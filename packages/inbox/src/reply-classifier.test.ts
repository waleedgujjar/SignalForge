import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '@signalforge/ai';

function createMockAiProvider(
  result: Awaited<ReturnType<AIProvider['classifyReply']>>,
): AIProvider {
  return {
    classifyReply: vi.fn(async () => result),
    suggestReply: vi.fn(),
    analyzeDeliverability: vi.fn(),
    analyzeWebsite: vi.fn(),
    generateEmail: vi.fn(),
    rewriteEmail: vi.fn(),
    scoreLead: vi.fn(),
  } as unknown as AIProvider;
}

describe('ReplyClassifier', () => {
  it('classifies unsubscribe requests via system heuristics', async () => {
    const ai = createMockAiProvider({
      category: 'INTERESTED',
      confidence: 0.99,
      summary: 'AI should not run',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_1',
      textBody: 'Please unsubscribe me from all emails.',
    });

    expect(result.classification).toBe('UNSUBSCRIBE');
    expect(result.source).toBe('SYSTEM');
    expect(ai.classifyReply).not.toHaveBeenCalled();
  });

  it('classifies out-of-office auto replies', async () => {
    const ai = createMockAiProvider({
      category: 'UNKNOWN',
      confidence: 0.5,
      summary: 'unused',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_2',
      subject: 'Out of office',
      textBody: 'I am away from the office until Monday.',
    });

    expect(result.classification).toBe('OUT_OF_OFFICE');
    expect(result.source).toBe('SYSTEM');
  });

  it('classifies not interested replies via keyword heuristics', async () => {
    const ai = createMockAiProvider({
      category: 'INTERESTED',
      confidence: 0.99,
      summary: 'unused',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_3',
      textBody: 'Thanks, but we are not interested at this time.',
    });

    expect(result.classification).toBe('NOT_INTERESTED');
    expect(result.source).toBe('SYSTEM');
  });

  it('classifies interested replies via keyword heuristics', async () => {
    const ai = createMockAiProvider({
      category: 'UNKNOWN',
      confidence: 0.5,
      summary: 'unused',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_4',
      textBody: "This sounds good — let's schedule a demo next week.",
    });

    expect(result.classification).toBe('INTERESTED');
    expect(result.source).toBe('SYSTEM');
  });

  it('classifies questions when body contains a question mark', async () => {
    const ai = createMockAiProvider({
      category: 'UNKNOWN',
      confidence: 0.5,
      summary: 'unused',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_5',
      textBody: 'Can you share pricing details for 50 seats?',
    });

    expect(result.classification).toBe('QUESTION');
    expect(result.source).toBe('SYSTEM');
  });

  it('delegates to AI when heuristics do not match', async () => {
    const ai = createMockAiProvider({
      category: 'NEEDS_FOLLOW_UP',
      confidence: 0.82,
      summary: 'Prospect asked to reconnect next quarter',
      suggestedAction: 'Schedule follow-up in Q2',
    });
    const { ReplyClassifier } = await import('./reply-classifier.js');
    const classifier = new ReplyClassifier(ai);

    const result = await classifier.classify({
      messageId: 'msg_6',
      textBody: 'Circle back with me in a few months.',
      detectUnsubscribeEnabled: false,
    });

    expect(result.classification).toBe('NEEDS_FOLLOW_UP');
    expect(result.source).toBe('AI');
    expect(result.confidence).toBe(0.82);
    expect(ai.classifyReply).toHaveBeenCalledWith({
      messageId: 'msg_6',
      body: 'Circle back with me in a few months.',
    });
  });
});
