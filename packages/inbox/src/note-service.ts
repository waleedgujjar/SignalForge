import { prisma, type ConversationNote } from '@signalforge/database';
import { logInboxEvent } from './activity.js';

export interface CreateNoteInput {
  conversationId: string;
  workspaceId: string;
  authorId: string;
  content: string;
}

export interface UpdateNoteInput {
  noteId: string;
  workspaceId: string;
  authorId: string;
  content: string;
}

export class NoteService {
  async create(input: CreateNoteInput): Promise<ConversationNote> {
    const note = await prisma.conversationNote.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        authorId: input.authorId,
        content: input.content.trim(),
      },
    });

    await prisma.conversationActivity.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        actorUserId: input.authorId,
        type: 'NOTE_ADDED',
        summary: 'Note added to conversation',
        metadata: { noteId: note.id },
      },
    });

    logInboxEvent('Conversation note added', {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      status: 'note_added',
    });

    return note;
  }

  async update(input: UpdateNoteInput): Promise<ConversationNote> {
    const existing = await prisma.conversationNote.findFirst({
      where: { id: input.noteId, workspaceId: input.workspaceId, authorId: input.authorId },
    });
    if (!existing) {
      throw new Error('Note not found or not authorized');
    }

    return prisma.conversationNote.update({
      where: { id: input.noteId },
      data: { content: input.content.trim() },
    });
  }

  async delete(noteId: string, workspaceId: string, authorId: string): Promise<void> {
    const existing = await prisma.conversationNote.findFirst({
      where: { id: noteId, workspaceId, authorId },
    });
    if (!existing) {
      throw new Error('Note not found or not authorized');
    }
    await prisma.conversationNote.delete({ where: { id: noteId } });
  }

  async list(conversationId: string, workspaceId: string): Promise<ConversationNote[]> {
    return prisma.conversationNote.findMany({
      where: { conversationId, workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const noteService = new NoteService();
