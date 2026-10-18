import type { FastifyPluginAsync } from 'fastify';
import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import { detectColumnMappings, parseFileStream } from '@signalforge/integrations';
import {
  emailVerificationService,
  verificationJobService,
  buildVerificationResultsXlsx,
  type VerificationExportRow,
} from '@signalforge/verification';
import { publishWorkflowEvent } from '@signalforge/automations';
import {
  bulkVerifySchema,
  updateVerificationPolicySchema,
  verificationExcelSchema,
  verificationHistoryQuerySchema,
  verificationJobListQuerySchema,
  verifyEmailSchema,
} from '@signalforge/validation';
import { Readable } from 'node:stream';

import { getWorkspaceId, requireWorkspaceGuard, requireWorkspaceRole } from '../plugins/auth.js';

function getActorUserId(request: { user?: { userId?: string } }): string | undefined {
  return request.user?.userId;
}

function verificationStatusLabel(status: string): string {
  if (status === 'VERIFIED') return 'Valid';
  if (status === 'ROLE_BASED') return 'Role';
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

    const [data, total] = await Promise.all([
      prisma.emailVerificationHistory.findMany({
        where,
        orderBy: { checkedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.emailVerificationHistory.count({ where }),
    ]);

    return { data, total, page: query.page, limit: query.limit };
  });

  app.get('/policy', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const policy = await prisma.workspaceVerificationPolicy.findFirst({ where: { workspaceId } });
    return policy ?? {
      excludeInvalid: true,
      excludeDisposable: true,
      excludeHighRisk: true,
      minScore: 50,
      blockUnverified: true,
      allowRoleEmails: false,
      blockRisky: true,
      blockUnknown: true,
    };
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

  app.post('/excel', async (request) => {
    const workspaceId = getWorkspaceId(request);
    const body = verificationExcelSchema.parse(request.body);
    const buffer = Buffer.from(body.file.data, 'base64');
    const parsed = await parseFileStream(Readable.from(buffer), body.file.mimeType);
    const mappings = detectColumnMappings(parsed.headers);
    const emailColumn =
      body.emailColumn ??
      mappings.find((mapping) => mapping.leadField === 'email')?.csvColumn ??
      parsed.headers.find((header) => header.toLowerCase().includes('email'));

    if (!emailColumn) {
      throw new Error('Could not detect email column. Specify emailColumn explicitly.');
    }

    const emails = parsed.rows
      .map((row) => row[emailColumn]?.trim())
      .filter((email): email is string => Boolean(email && email.includes('@')));

    const job = await verificationJobService.createJob({
      workspaceId,
      initiatedByUserId: getActorUserId(request),
      source: 'EXCEL',
      name: body.name ?? body.file.filename ?? 'Excel verification',
      emails,
      metadata: {
        emailColumn,
        headers: parsed.headers,
        rows: parsed.rows,
        originalFilename: body.file.filename,
      },
    });

    return { jobId: job.id, status: job.status, total: job.total, emailColumn };
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
    };

    const history = await prisma.emailVerificationHistory.findMany({
      where: { workspaceId, jobId },
    });
    const byEmail = new Map(history.map((entry) => [entry.normalizedEmail, entry]));

    const headers = metadata.headers ?? ['email'];
    const emailColumn = metadata.emailColumn ?? 'email';
    const sourceRows = metadata.rows ?? [];

    const exportRows: VerificationExportRow[] = sourceRows.map((row) => {
      const email = row[emailColumn]?.trim().toLowerCase() ?? '';
      const entry = email ? byEmail.get(email) : undefined;
      return {
        ...row,
        email_verification_status: entry?.status ?? '',
        email_risk_score: entry?.riskScore ?? null,
        email_confidence_score: entry?.confidenceScore ?? null,
        email_verification_reason: entry?.reasonMessage ?? null,
        email_is_disposable: entry?.status === 'DISPOSABLE' ? true : null,
        email_is_role: entry?.status === 'ROLE_BASED' ? true : null,
        email_is_catch_all: entry?.status === 'RISKY' ? true : null,
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
