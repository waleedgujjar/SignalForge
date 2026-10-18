import { prisma } from '@signalforge/database';

export interface CreateNotificationInput {
  workspaceId: string;
  userId?: string;
  title: string;
  body: string;
  href?: string;
  workflowExecutionId?: string;
}

export class NotificationService {
  async create(input: CreateNotificationInput): Promise<unknown> {
    if (!input.userId) {
      const admins = await prisma.workspaceMember.findMany({
        where: {
          workspaceId: input.workspaceId,
          role: { in: ['OWNER', 'ADMIN'] },
        },
        select: { userId: true },
      });

      if (admins.length === 0) {
        return prisma.notification.create({ data: input });
      }

      return prisma.notification.createMany({
        data: admins.map((a) => ({
          workspaceId: input.workspaceId,
          userId: a.userId,
          title: input.title,
          body: input.body,
          href: input.href,
          workflowExecutionId: input.workflowExecutionId,
        })),
      });
    }

    return prisma.notification.create({ data: input });
  }

  async list(workspaceId: string, userId: string, options?: { unreadOnly?: boolean; limit?: number }) {
    return prisma.notification.findMany({
      where: {
        workspaceId,
        OR: [{ userId }, { userId: null }],
        ...(options?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }

  async markRead(notificationId: string, workspaceId: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        workspaceId,
        OR: [{ userId }, { userId: null }],
      },
    });
    if (!notification) throw new Error('Notification not found');
    if (!userId) throw new Error('Notification not found');

    return prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async unreadCount(workspaceId: string, userId: string) {
    return prisma.notification.count({
      where: {
        workspaceId,
        OR: [{ userId }, { userId: null }],
        readAt: null,
      },
    });
  }
}

export const notificationService = new NotificationService();
