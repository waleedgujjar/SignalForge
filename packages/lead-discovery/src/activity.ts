/// Audit trail for discovery.
///
/// SignalForge has no generic AuditLog table; the established convention is a
/// per-domain activity table written through a small helper (see
/// packages/campaigns/src/activity.ts). This mirrors that exactly rather than
/// inventing a competing audit mechanism.

import type { LeadDiscoveryActivityType, Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';

export async function logDiscoveryActivity(input: {
  workspaceId: string;
  type: LeadDiscoveryActivityType;
  summary: string;
  jobId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.leadDiscoveryActivity.create({
    data: {
      workspaceId: input.workspaceId,
      jobId: input.jobId ?? null,
      type: input.type,
      summary: input.summary,
      actorUserId: input.actorUserId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function listDiscoveryActivity(workspaceId: string, jobId?: string, limit = 50) {
  return prisma.leadDiscoveryActivity.findMany({
    where: { workspaceId, ...(jobId ? { jobId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
