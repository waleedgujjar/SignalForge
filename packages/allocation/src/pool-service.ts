import { prisma, Prisma } from '@signalforge/database';
import type { RotationStrategy } from './types.js';

export interface CreatePoolInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  strategy?: RotationStrategy;
  enabled?: boolean;
}

export interface UpdatePoolInput {
  name?: string;
  description?: string | null;
  strategy?: RotationStrategy;
  enabled?: boolean;
}

export interface AddPoolMemberInput {
  poolId: string;
  workspaceId: string;
  mailboxId: string;
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePoolMemberInput {
  priority?: number;
  enabled?: boolean;
}

export class PoolNotFoundError extends Error {
  constructor(poolId: string) {
    super(`SMTP pool ${poolId} not found`);
    this.name = 'PoolNotFoundError';
  }
}

export class PoolNameConflictError extends Error {
  constructor(name: string) {
    super(`SMTP pool named "${name}" already exists in workspace`);
    this.name = 'PoolNameConflictError';
  }
}

export class MailboxNotInWorkspaceError extends Error {
  constructor(mailboxId: string) {
    super(`Mailbox ${mailboxId} does not belong to workspace`);
    this.name = 'MailboxNotInWorkspaceError';
  }
}

export class SmtpPoolService {
  async createPool(input: CreatePoolInput) {
    try {
      return await prisma.smtpPool.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description ?? null,
          strategy: input.strategy ?? 'ROUND_ROBIN',
          enabled: input.enabled ?? true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PoolNameConflictError(input.name);
      }
      throw error;
    }
  }

  async listPools(workspaceId: string) {
    return prisma.smtpPool.findMany({
      where: { workspaceId },
      include: {
        members: {
          include: {
            mailbox: {
              select: {
                id: true,
                emailAddress: true,
                fromName: true,
                status: true,
                healthStatus: true,
                dailySendingLimit: true,
                currentDailyUsage: true,
              },
            },
          },
        },
      },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      take: 100,
    });
  }

  async getPool(workspaceId: string, poolId: string) {
    const pool = await prisma.smtpPool.findFirst({
      where: { id: poolId, workspaceId },
      include: {
        members: {
          include: {
            mailbox: {
              select: {
                id: true,
                emailAddress: true,
                fromName: true,
                status: true,
                healthStatus: true,
                dailySendingLimit: true,
                currentDailyUsage: true,
                verifiedAt: true,
              },
            },
          },
          orderBy: [{ enabled: 'desc' }, { priority: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!pool) throw new PoolNotFoundError(poolId);
    return pool;
  }

  async updatePool(workspaceId: string, poolId: string, input: UpdatePoolInput) {
    const existing = await prisma.smtpPool.findFirst({ where: { id: poolId, workspaceId } });
    if (!existing) throw new PoolNotFoundError(poolId);
    try {
      return await prisma.smtpPool.update({
        where: { id: poolId },
        data: {
          name: input.name ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          strategy: input.strategy ?? undefined,
          enabled: input.enabled ?? undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PoolNameConflictError(input.name ?? existing.name);
      }
      throw error;
    }
  }

  async deletePool(workspaceId: string, poolId: string) {
    const existing = await prisma.smtpPool.findFirst({ where: { id: poolId, workspaceId } });
    if (!existing) throw new PoolNotFoundError(poolId);
    await prisma.smtpPool.delete({ where: { id: poolId } });
  }

  async addMember(input: AddPoolMemberInput) {
    const pool = await prisma.smtpPool.findFirst({
      where: { id: input.poolId, workspaceId: input.workspaceId },
    });
    if (!pool) throw new PoolNotFoundError(input.poolId);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: input.mailboxId, workspaceId: input.workspaceId },
    });
    if (!mailbox) throw new MailboxNotInWorkspaceError(input.mailboxId);

    return prisma.smtpPoolAccount.upsert({
      where: { poolId_mailboxId: { poolId: input.poolId, mailboxId: input.mailboxId } },
      create: {
        poolId: input.poolId,
        mailboxId: input.mailboxId,
        priority: input.priority ?? 0,
        enabled: input.enabled ?? true,
      },
      update: {
        priority: input.priority ?? undefined,
        enabled: input.enabled ?? undefined,
      },
    });
  }

  async updateMember(
    workspaceId: string,
    poolId: string,
    mailboxId: string,
    input: UpdatePoolMemberInput,
  ) {
    const pool = await prisma.smtpPool.findFirst({ where: { id: poolId, workspaceId } });
    if (!pool) throw new PoolNotFoundError(poolId);

    return prisma.smtpPoolAccount.update({
      where: { poolId_mailboxId: { poolId, mailboxId } },
      data: {
        priority: input.priority ?? undefined,
        enabled: input.enabled ?? undefined,
      },
    });
  }

  async removeMember(workspaceId: string, poolId: string, mailboxId: string) {
    const pool = await prisma.smtpPool.findFirst({ where: { id: poolId, workspaceId } });
    if (!pool) throw new PoolNotFoundError(poolId);

    await prisma.smtpPoolAccount.deleteMany({ where: { poolId, mailboxId } });
  }

  async getPoolHealth(workspaceId: string, poolId: string) {
    const pool = await this.getPool(workspaceId, poolId);
    const total = pool.members.length;
    const enabled = pool.members.filter((m) => m.enabled).length;
    const healthy = pool.members.filter(
      (m) => m.mailbox.status === 'ACTIVE' && m.mailbox.healthStatus === 'HEALTHY' && m.enabled,
    ).length;
    const degraded = pool.members.filter(
      (m) => m.mailbox.healthStatus === 'DEGRADED' && m.enabled,
    ).length;
    const unhealthy = pool.members.filter(
      (m) => m.mailbox.healthStatus === 'UNHEALTHY' && m.enabled,
    ).length;
    const capacityToday = pool.members.reduce((sum, member) => {
      if (!member.enabled) return sum;
      return sum + Math.max(0, member.mailbox.dailySendingLimit - member.mailbox.currentDailyUsage);
    }, 0);

    return { poolId: pool.id, enabled: pool.enabled, total, enabledMembers: enabled, healthy, degraded, unhealthy, capacityToday };
  }
}

export const smtpPoolService = new SmtpPoolService();
