/**
 * Stage 2: enqueue website analysis for leads with websites.
 */

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
    _queue = createQueue(QUEUE_NAMES.WEBSITE_ANALYSIS, connection);
  }
  return _queue;
}

export async function closeWebsiteAnalysisQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}

export async function enqueueWebsiteAnalysisForLead(
  workspaceId: string,
  leadId: string,
): Promise<string | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    select: { website: true, companyDomain: true },
  });

  if (!lead) return null;

  const url = lead.website || (lead.companyDomain ? `https://${lead.companyDomain}` : null);
  if (!url) return null;

  let domain: string;
  let normalizedUrl: string;
  try {
    normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    domain = new URL(normalizedUrl).hostname;
  } catch {
    return null;
  }

  // Idempotency: skip if a non-FAILED analysis already exists for this lead
  const existing = await prisma.websiteAnalysis.findFirst({
    where: {
      leadId,
      workspaceId,
      status: { in: ['PENDING', 'CRAWLING', 'ANALYZING', 'COMPLETED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const analysis = await prisma.websiteAnalysis.create({
    data: {
      workspaceId,
      leadId,
      domain,
      url: normalizedUrl,
      status: 'PENDING',
    },
  });

  const queue = getOrCreateQueue();
  await queue.add(
    'analyze',
    {
      workspaceId,
      leadId,
      analysisId: analysis.id,
      url: normalizedUrl,
      domain,
    },
    DEFAULT_JOB_OPTIONS,
  );

  await prisma.discoveredLead.updateMany({
    where: { promotedLeadId: leadId, workspaceId },
    data: { stage: 'WEBSITE_ANALYZED' },
  }).catch(() => {});

  return analysis.id;
}

export async function enqueueWebsiteAnalysisForLeads(
  workspaceId: string,
  leadIds: string[],
): Promise<{ queued: number; analysisIds: string[] }> {
  const analysisIds: string[] = [];
  let queued = 0;

  for (const leadId of leadIds) {
    const id = await enqueueWebsiteAnalysisForLead(workspaceId, leadId);
    if (id) {
      analysisIds.push(id);
      queued += 1;
    }
  }

  return { queued, analysisIds };
}
