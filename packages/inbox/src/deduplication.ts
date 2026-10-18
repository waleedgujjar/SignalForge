import { prisma } from '@signalforge/database';

export interface DeduplicationCheckInput {
  workspaceId: string;
  providerMessageId?: string | null;
  internetMessageId?: string | null;
}

export interface DeduplicationCheckResult {
  duplicate: boolean;
  existingMessageId?: string;
  existingConversationId?: string;
}

export async function checkMessageDuplicate(
  input: DeduplicationCheckInput,
): Promise<DeduplicationCheckResult> {
  if (input.providerMessageId) {
    const byProvider = await prisma.conversationMessage.findUnique({
      where: {
        workspaceId_providerMessageId: {
          workspaceId: input.workspaceId,
          providerMessageId: input.providerMessageId,
        },
      },
      select: { id: true, conversationId: true },
    });
    if (byProvider) {
      return {
        duplicate: true,
        existingMessageId: byProvider.id,
        existingConversationId: byProvider.conversationId,
      };
    }
  }

  if (input.internetMessageId) {
    const byInternet = await prisma.conversationMessage.findFirst({
      where: {
        workspaceId: input.workspaceId,
        internetMessageId: input.internetMessageId,
      },
      select: { id: true, conversationId: true },
    });
    if (byInternet) {
      return {
        duplicate: true,
        existingMessageId: byInternet.id,
        existingConversationId: byInternet.conversationId,
      };
    }
  }

  return { duplicate: false };
}
