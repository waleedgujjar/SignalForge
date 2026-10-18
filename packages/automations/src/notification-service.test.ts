import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    notification: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@signalforge/database', () => ({ prisma: mockPrisma }));

import { NotificationService } from './notification-service.js';

let service: NotificationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new NotificationService();
});

describe('NotificationService.create', () => {
  it('creates notification for a specific user', async () => {
    const input = {
      workspaceId: 'ws1',
      userId: 'user1',
      title: 'Test',
      body: 'Hello',
    };
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1', ...input });

    await service.create(input);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({ data: input });
  });

  it('creates notifications for all admins when userId is missing', async () => {
    const input = {
      workspaceId: 'ws1',
      title: 'Test',
      body: 'Hello',
    };
    mockPrisma.workspaceMember.findMany.mockResolvedValue([
      { userId: 'admin1' },
      { userId: 'admin2' },
    ]);
    mockPrisma.notification.createMany.mockResolvedValue({ count: 2 });

    await service.create(input);
    expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'admin1', title: 'Test' }),
        expect.objectContaining({ userId: 'admin2', title: 'Test' }),
      ],
    });
  });

  it('creates single notification when no admins found and no userId', async () => {
    const input = {
      workspaceId: 'ws1',
      title: 'Test',
      body: 'Hello',
    };
    mockPrisma.workspaceMember.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create(input);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({ data: input });
  });

  it('passes href and workflowExecutionId', async () => {
    const input = {
      workspaceId: 'ws1',
      userId: 'user1',
      title: 'Test',
      body: 'Body',
      href: '/leads/123',
      workflowExecutionId: 'exec1',
    };
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });

    await service.create(input);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({ data: input });
  });
});

describe('NotificationService.list', () => {
  it('returns notifications for a workspace and user', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);

    const result = await service.list('ws1', 'user1');
    expect(result).toEqual([{ id: 'n1' }]);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'ws1' }),
        take: 50,
      }),
    );
  });

  it('filters unread only when option is set', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);

    await service.list('ws1', 'user1', { unreadOnly: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ readAt: null }),
      }),
    );
  });

  it('respects custom limit', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);

    await service.list('ws1', 'user1', { limit: 10 });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe('NotificationService.markRead', () => {
  it('marks notification as read', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1', userId: 'user1' });
    mockPrisma.notification.update.mockResolvedValue({ id: 'n1', readAt: new Date() });

    await service.markRead('n1', 'ws1', 'user1');
    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { readAt: expect.any(Date) },
    });
  });

  it('throws when notification not found', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    await expect(service.markRead('n1', 'ws1', 'user1')).rejects.toThrow('Notification not found');
  });

  it('throws when userId is empty', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1' });

    await expect(service.markRead('n1', 'ws1', '')).rejects.toThrow('Notification not found');
  });
});

describe('NotificationService.unreadCount', () => {
  it('returns unread count', async () => {
    mockPrisma.notification.count.mockResolvedValue(5);

    const count = await service.unreadCount('ws1', 'user1');
    expect(count).toBe(5);
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: 'ws1',
        readAt: null,
      }),
    });
  });
});
