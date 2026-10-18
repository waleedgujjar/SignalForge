/// Audit trail for research.
///
/// SignalForge has no generic AuditLog table; the established convention is a
/// per-domain activity table written through a small helper (see
/// packages/lead-discovery/src/activity.ts). This mirrors that exactly. Rows
/// hold ids, operation/status codes and short messages only — never raw
/// provider output or anything credential-like, hence the sanitizer on the
/// one free-text column.

import type { LeadResearchSource, Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';

import { sanitizeSecrets } from './sanitize.js';

export type ResearchActivityOperation =
  | 'RESEARCH_REQUESTED'
  | 'RESEARCH_APPROVED'
  | 'RESEARCH_STARTED'
  | 'RESEARCH_COMPLETED'
  | 'RESEARCH_MANUAL_REVIEW'
  | 'RESEARCH_FAILED'
  | 'RESEARCH_SKIPPED'
  | 'RESEARCH_RETRIED'
  | 'MANUAL_VERIFICATION_SAVED'
  | 'MARKED_VERIFIED'
  | 'PROVIDER_HEALTH_CHECK'
  | 'PROVIDER_TOGGLED';

const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface LogResearchActivityInput {
  workspaceId: string;
  /// Null for provider-level events (health checks, toggles) that have no lead;
  /// every record-level event sets it so the lead page can list its own trail.
  leadId?: string | null;
  researchId?: string | null;
  source?: LeadResearchSource;
  provider?: string | null;
  operation: ResearchActivityOperation;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  actorUserId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export async function logResearchActivity(input: LogResearchActivityInput) {
  const errorMessage = input.errorMessage
    ? sanitizeSecrets(input.errorMessage).slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : null;

  return prisma.leadResearchActivity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId ?? null,
      researchId: input.researchId ?? null,
      source: input.source ?? 'LINKEDIN',
      provider: input.provider ?? null,
      operation: input.operation,
      status: input.status,
      errorCode: input.errorCode ?? null,
      errorMessage,
      actorUserId: input.actorUserId ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function listResearchActivity(
  workspaceId: string,
  filter: { leadId?: string; researchId?: string } = {},
  limit = 50,
) {
  return prisma.leadResearchActivity.findMany({
    where: {
      workspaceId,
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
      ...(filter.researchId ? { researchId: filter.researchId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
