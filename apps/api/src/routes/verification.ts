import type { FastifyPluginAsync } from 'fastify';
import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import { parseFileStream } from '@signalforge/integrations';
import {
  emailVerificationService,
  verificationJobService,
  buildVerificationResultsXlsx,
  type VerificationExportRow,
} from '@signalforge/verification';
import { publishWorkflowEvent } from '@signalforge/automations';
import { resolveVerificationPolicy } from '@signalforge/email';
import {
  bulkVerifySchema,
  updateVerificationPolicySchema,
  verificationHistoryQuerySchema,
  verificationJobListQuerySchema,
  verifyEmailSchema,
} from '@signalforge/validation';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';

import { getWorkspaceId, requireWorkspaceGuard, requireWorkspaceRole } from '../plugins/auth.js';
import { extractEmail } from './verification-upload.js';

function getActorUserId(request: { user?: { userId?: string } }): string | undefined {
  return request.user?.userId;
}

function verificationStatusLabel(status: string): string {
  if (status === 'VERIFIED') return 'Valid';
  if (status === 'ROLE_BASED') return 'Role';
  if (status === 'CATCH_ALL') return 'Catch-all';
  return status;
}

export const verificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspaceGuard().preHandler);

  app.post('/check', async (request) => {
    const body = verifyEmailSchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);

    let leadId = body.leadId;
    if (!leadId) {
      const lead = await prisma.lead.findFirst({
        where: { workspaceId, email: body.email.toLowerCase() },
        select: { id: true },
      });
      leadId = lead?.id;
    }

    const result = await emailVerificationService.verifyAndPersist(body.email, {
      workspaceId,
      leadId,
      options: { forceRecheck: body.forceRecheck, workspaceId },
    });

    if (leadId) {
      void publishWorkflowEvent({
        eventType: 'LEAD_VERIFIED',
        workspaceId,
        leadId,
        idempotencyKey: `lead-verified:${leadId}:${result.status}:${Date.now()}`,
        metadata: { status: result.status, score: result.score, riskScore: result.riskScore },
      }).catch(() => {});
    }

    return { ...result, statusLabel: verificationStatusLabel(result.status) };
  });

  app.post('/bulk', async (request) => {
    const body = bulkVerifySchema.parse(request.body);
    const workspaceId = getWorkspaceId(request);
    const env = loadEnv();

    const emailCount = (body.emails?.length ?? 0) + (body.leadIds?.length ?? 0);
    if (emailCount > env.EMAIL_VERIFICATION_MAX_BULK_SIZE) {
      throw new Error(`Maximum ${env.EMAIL_VERIFICATION_MAX_BULK_SIZE} emails per bulk job`);
    }

    const job = await verificationJobService.createJob({
      workspaceId,
      initiatedByUserId: getActorUserId(request),
      source: body.source ?? (body.leadIds?.length ? 'LEADS' : 'PASTE'),
      name: body.name,
      emails: body.emails,
      leadIds: body.leadIds,
    });

    return { jobId: job.id, status: job.status, total: job.total };
  });

  app.get('/jobs', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = verificationJobListQuerySchema.parse(request.query ?? {});
    return verificationJobService.listJobs(workspaceId, query);
  });

  app.get('/jobs/:id', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const job = await verificationJobService.getJob(id, workspaceId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return job;
  });

  app.post('/jobs/:id/pause', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const result = await verificationJobService.pauseJob(id, workspaceId);
    if (result.count === 0) return reply.status(404).send({ error: 'Job not found or not pausable' });
    return { ok: true };
  });

  app.post('/jobs/:id/resume', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const result = await verificationJobService.resumeJob(id, workspaceId);
    if (result.count === 0) return reply.status(404).send({ error: 'Job not found or not resumable' });
    return { ok: true };
  });

  app.post('/jobs/:id/cancel', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { id } = request.params as { id: string };
    const result = await verificationJobService.cancelJob(id, workspaceId);
    if (result.count === 0) return reply.status(404).send({ error: 'Job not found or not cancellable' });
    return { ok: true };
  });

  app.get('/history', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const query = verificationHistoryQuerySchema.parse(request.query ?? {});
    const skip = (query.page - 1) * query.limit;

    const where = {
      workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { normalizedEmail: { contains: query.search.toLowerCase() } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.emailVerificationHistory.findMany({
        where,
        orderBy: { checkedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.emailVerificationHistory.count({ where }),
    ]);

    // Merge associated lead company/contact where the history row is linked to a
    // lead (the history model has no Lead relation, so look them up in one query).
    const leadIds = [...new Set(rows.map((row) => row.leadId).filter((id): id is string => Boolean(id)))];
    const leads = leadIds.length
      ? await prisma.lead.findMany({
          where: { workspaceId, id: { in: leadIds } },
          select: { id: true, company: true, fullName: true, firstName: true, lastName: true },
        })
      : [];
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    const data = rows.map((row) => {
      const lead = row.leadId ? leadById.get(row.leadId) : undefined;
      const contact = lead
        ? lead.fullName ?? ([lead.firstName, lead.lastName].filter(Boolean).join(' ') || null)
        : null;
      return {
        ...row,
        source: row.jobId ? 'JOB' : 'SINGLE',
        company: lead?.company ?? null,
        contact: contact || null,
      };
    });

    return { data, total, page: query.page, limit: query.limit };
  });

  app.get('/policy', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const policy = await prisma.workspaceVerificationPolicy.findFirst({ where: { workspaceId } });
    return { ...resolveVerificationPolicy(policy), ...(policy ?? {}) };
  });

  app.patch('/policy', { preHandler: requireWorkspaceRole('ADMIN').preHandler }, async (request) => {
    const workspaceId = getWorkspaceId(request);
    const body = updateVerificationPolicySchema.parse(request.body);

    return prisma.workspaceVerificationPolicy.upsert({
      where: { workspaceId },
      create: { workspaceId, ...body },
      update: body,
    });
  });

  app.get('/export/:jobId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { jobId } = request.params as { jobId: string };

    const job = await verificationJobService.getJob(jobId, workspaceId);
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const metadata = job.metadata as {
      headers?: string[];
      rows?: Record<string, string>[];
      emailColumn?: string;
      filePath?: string;
      mimeType?: string;
      originalFilename?: string | null;
    };

    const history = await prisma.emailVerificationHistory.findMany({
      where: { workspaceId, jobId },
      orderBy: { checkedAt: 'asc' },
    });
    const byEmail = new Map(history.map((entry) => [entry.normalizedEmail.toLowerCase(), entry]));

    let headers = metadata.headers ?? ['email'];
    let emailColumn = metadata.emailColumn ?? 'email';
    let sourceRows: Record<string, string>[] = metadata.rows ?? [];
    if (metadata.filePath && (await fileExists(metadata.filePath))) {
      // Re-read the uploaded file so the export keeps every original column.
      const parsed = await parseFileStream(createReadStream(metadata.filePath), metadata.mimeType ?? 'text/csv', {
        filename: metadata.originalFilename ?? undefined,
      });
      sourceRows = parsed.rows;
      headers = parsed.headers;
    } else if (sourceRows.length === 0) {
      // Pasted lists, or a file that is no longer on disk: export the results alone.
      headers = ['email'];
      emailColumn = 'email';
      sourceRows = history.map((entry) => ({ email: entry.email }));
    }

    const exportRows: VerificationExportRow[] = sourceRows.map((row) => {
      const email = extractEmail(row[emailColumn]) ?? '';
      const entry = email ? byEmail.get(email) : undefined;
      return {
        ...row,
        email_verification_status: entry ? verificationStatusLabel(entry.status) : '',
        email_risk_score: entry?.riskScore ?? null,
        email_confidence_score: entry?.confidenceScore ?? null,
        email_verification_reason: entry?.reasonMessage ?? null,
        email_is_disposable: entry ? entry.status === 'DISPOSABLE' : null,
        email_is_role: entry ? entry.status === 'ROLE_BASED' : null,
        email_is_catch_all: entry ? entry.status === 'CATCH_ALL' : null,
      };
    });

    const buffer = await buildVerificationResultsXlsx(exportRows, headers);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="verification-${jobId}.xlsx"`);
    return reply.send(buffer);
  });

  app.get('/:leadId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { verification: true },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const history = await prisma.emailVerificationHistory.findMany({
      where: { workspaceId, leadId },
      orderBy: { checkedAt: 'desc' },
      take: 10,
    });

    return { verification: lead.verification, history };
  });

  app.post('/:leadId/recheck', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { leadId } = request.params as { leadId: string };

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      select: { id: true, email: true },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    const result = await emailVerificationService.verifyAndPersist(lead.email, {
      workspaceId,
      leadId: lead.id,
      options: { forceRecheck: true, workspaceId },
    });

    void publishWorkflowEvent({
      eventType: 'LEAD_VERIFIED',
      workspaceId,
      leadId: lead.id,
      idempotencyKey: `email-recheck:${lead.id}:${Date.now()}`,
      metadata: { status: result.status, score: result.score, recheck: true },
    }).catch(() => {});

    return { ...result, statusLabel: verificationStatusLabel(result.status) };
  });
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
