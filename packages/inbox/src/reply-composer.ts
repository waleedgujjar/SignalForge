import type { AIProvider } from '@signalforge/ai';
import { conversationService } from './conversation-service.js';
import { messageService } from './message-service.js';
import type { ComposeReplyInput, ComposeReplyResult } from './types.js';

export class ReplyComposer {
  constructor(private readonly aiProvider: AIProvider) {}

  async composeDraft(input: ComposeReplyInput): Promise<ComposeReplyResult> {
    const conversation = await conversationService.findById(input.conversationId, input.workspaceId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const latestBody = await messageService.getLatestInboundBody(
      input.conversationId,
      input.workspaceId,
    );

    const suggestion = await this.aiProvider.suggestReply({
      threadId: input.conversationId,
      body: latestBody,
    });

    const tone = input.tone ?? suggestion.tone;
    const subject = conversation.subject?.startsWith('Re:')
      ? conversation.subject
      : `Re: ${conversation.subject ?? 'Your message'}`;

    return {
      subject,
      body: suggestion.draft,
      tone,
    };
  }
}

export function createReplyComposer(aiProvider: AIProvider): ReplyComposer {
  return new ReplyComposer(aiProvider);
}
