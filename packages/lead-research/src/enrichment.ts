/// Re-queue enrichment for a lead after research completes or is verified.
///
/// The forceRefresh flag ensures the enrichment worker recomputes even if the
/// lead's inputHash hasn't changed from its perspective (the research rows
/// changed, which affects the enrichment input).

import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  DEFAULT_JOB_OPTIONS,
} from '@signalforge/queue';

export async function ensureEnrichmentQueued(workspaceId: string, leadId: string): Promise<void> {
  // Upsert: create if missing, or reset to QUEUED if in a terminal state.
  const enrichment = await prisma.leadEnrichment.upsert({
    where: { leadId },
    create: { leadId, workspaceId, status: 'QUEUED' },
    update: { status: 'QUEUED', updatedAt: new Date() },
  });

  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(QUEUE_NAMES.LEAD_ENRICHMENT, connection);

  await queue.add(
    'enrich-lead',
    {
      workspaceId,
      leadId,
      enrichmentId: enrichment.id,
      forceRefresh: true,
    },
    {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `enrich-after-research-${leadId}`,
    },
  );
}
