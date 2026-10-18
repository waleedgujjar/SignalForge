import type { FastifyPluginAsync } from 'fastify';
import { sendingJobService } from '@signalforge/sending';
import { sendingJobListQuerySchema } from '@signalforge/validation';
import { requireWorkspaceGuard, getWorkspaceId } from '../plugins/auth.js';

function handleSendingError(error: unknown, reply: {
  status: (code: number) => { send: (body: unknown) => unknown };
}) {
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({ error: error.message });
    }
    if (
      error.message.includes('Cannot') ||
      error.message.includes('cannot') ||
      error.message.includes('required')
    ) {
      return reply.status(400).send({ error: error.message });
    }
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

export const sendingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.get('/jobs', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = sendingJobListQuerySchema.parse(request.query ?? {});

    return sendingJobService.listJobs(
      workspaceId,
      {
        campaignId: query.campaignId,
        status: query.status,
        mailboxId: query.mailboxId,
        leadId: query.leadId,
        errorCategory: query.errorCategory,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        search: query.search,
      },
      { page: query.page, limit: query.limit },
    );
  });

  app.get('/jobs/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const job = await sendingJobService.getJob(id, workspaceId);
    if (!job) {
      return reply.status(404).send({ error: 'Sending job not found' });
    }
    return job;
  });

  app.get('/queue/stats', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const counts = await sendingJobService.getQueueStats(workspaceId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const pending = counts.PENDING + counts.SCHEDULED + counts.RETRYING + counts.PAUSED;
    return {
      counts,
      total,
      pending,
      processing: counts.PROCESSING,
      sent: counts.SENT,
      failed: counts.FAILED,
      cancelled: counts.CANCELLED,
    };
  });

  app.post('/jobs/:id/retry', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      const job = await sendingJobService.retryJob(id, workspaceId);
      return job;
    } catch (error) {
      return handleSendingError(error, reply);
    }
  });

  app.post('/jobs/:id/cancel', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    try {
      const job = await sendingJobService.cancelJob(id, workspaceId);
      return job;
    } catch (error) {
      return handleSendingError(error, reply);
    }
  });
};
