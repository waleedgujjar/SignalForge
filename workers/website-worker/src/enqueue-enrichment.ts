import { prisma } from '@signalforge/database';
import { loadEnv } from '@signalforge/config';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  DEFAULT_JOB_OPTIONS,
} from '@signalforge/queue';

let _queue: ReturnType<typeof createQueue> | null = null;

function getOrCreateQueue() {
  if (!_queue) {
    const env = loadEnv();
    const connection = createRedisConnection(env.REDIS_URL);
    _queue = createQueue(QUEUE_NAMES.LEAD_ENRICHMENT, connection);
  }
  return _queue;
}

export async function enqueueEnrichmentAfterAnalysis(
  workspaceId: string,
  leadId: string,
): Promise<string | null> {
  const existing = await prisma.leadEnrichment.findUnique({
    where: { leadId },
    select: { id: true, status: true },
  });

  if (existing && ['QUEUED', 'ENRICHING', 'COMPLETED'].includes(existing.status)) {
    return existing.id;
  }

  const enrichment = await prisma.leadEnrichment.upsert({
    where: { leadId },
    create: { leadId, workspaceId, status: 'QUEUED' },
    update: { status: 'QUEUED', errorMessage: null },
  });

  const queue = getOrCreateQueue();
  await queue.add(
    'enrich-lead',
    {
      workspaceId,
      leadId,
      enrichmentId: enrichment.id,
    },
    DEFAULT_JOB_OPTIONS,
  );

  return enrichment.id;
}
