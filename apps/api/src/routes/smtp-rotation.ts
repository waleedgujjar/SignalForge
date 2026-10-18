import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@signalforge/database';
import { updateRotationSettingsSchema } from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

async function ensurePolicy(workspaceId: string) {
  return prisma.sendingPolicy.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      rotationStrategy: 'ROUND_ROBIN',
      enabled: true,
      degradedMailboxPolicy: 'ALLOW',
    },
    update: {},
  });
}

export const smtpRotationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/settings', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const policy = await prisma.sendingPolicy.findUnique({ where: { workspaceId } });
    if (!policy) {
      return {
        workspaceId,
        rotationStrategy: 'ROUND_ROBIN',
        enabled: true,
        degradedMailboxPolicy: 'ALLOW',
      };
    }
    return policy;
  });

  app.patch('/settings', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const body = updateRotationSettingsSchema.parse(request.body);
    await ensurePolicy(workspaceId);
    return prisma.sendingPolicy.update({
      where: { workspaceId },
      data: {
        rotationStrategy: body.rotationStrategy,
        enabled: body.enabled,
        degradedMailboxPolicy: body.degradedMailboxPolicy,
      },
    });
  });

  app.get('/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const [pools, mailboxes, todayHistory] = await Promise.all([
      prisma.smtpPool.findMany({
        where: { workspaceId },
        include: {
          members: {
            include: {
              mailbox: {
                select: {
                  id: true,
                  dailySendingLimit: true,
                  currentDailyUsage: true,
                  status: true,
                  healthStatus: true,
                },
              },
            },
          },
        },
      }),
      prisma.mailbox.findMany({
        where: { workspaceId },
        select: { id: true, dailySendingLimit: true, currentDailyUsage: true, status: true },
      }),
      prisma.mailboxAllocationHistory.groupBy({
        by: ['mailboxId', 'outcome'],
        where: {
          workspaceId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        _count: { _all: true },
      }),
    ]);

    const totalCapacity = mailboxes.reduce(
      (sum, m) => sum + (m.status === 'ACTIVE' ? m.dailySendingLimit : 0),
      0,
    );
    const usedCapacity = mailboxes.reduce(
      (sum, m) => sum + (m.status === 'ACTIVE' ? m.currentDailyUsage : 0),
      0,
    );

    const poolStats = pools.map((pool) => {
      const capacity = pool.members.reduce((sum, member) => {
        if (!member.enabled) return sum;
        return sum + Math.max(0, member.mailbox.dailySendingLimit - member.mailbox.currentDailyUsage);
      }, 0);
      return {
        id: pool.id,
        name: pool.name,
        enabled: pool.enabled,
        strategy: pool.strategy,
        memberCount: pool.members.length,
        enabledMemberCount: pool.members.filter((m) => m.enabled).length,
        capacityToday: capacity,
      };
    });

    const distribution = new Map<string, { allocated: number; failures: number }>();
    for (const row of todayHistory) {
      const key = row.mailboxId ?? 'unassigned';
      const entry = distribution.get(key) ?? { allocated: 0, failures: 0 };
      if (row.outcome === 'ALLOCATED' || row.outcome === 'IDEMPOTENT_HIT') {
        entry.allocated += row._count._all;
      } else {
        entry.failures += row._count._all;
      }
      distribution.set(key, entry);
    }

    return {
      totalCapacity,
      usedCapacity,
      remainingCapacity: Math.max(0, totalCapacity - usedCapacity),
      pools: poolStats,
      allocationsToday: Array.from(distribution.entries()).map(([mailboxId, counts]) => ({
        mailboxId,
        ...counts,
      })),
    };
  });
};
