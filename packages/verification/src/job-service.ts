import { prisma, type EmailVerificationJobSource } from '@signalforge/database';
import { enqueueEmailVerificationBatch } from '@signalforge/queue';

import { getVerificationQueue } from './queue.js';

const ENQUEUE_CHUNK_SIZE = 1000;

export class VerificationJobService {
  async createJob(input: {
    workspaceId: string;
    initiatedByUserId?: string;
    source: EmailVerificationJobSource;
    name?: string;
    emails?: string[];
    leadIds?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const emails = [...(input.emails ?? [])];

    if (input.leadIds?.length) {
      const leads = await prisma.lead.findMany({
        where: { workspaceId: input.workspaceId, id: { in: input.leadIds } },
        select: { email: true },
      });
      emails.push(...leads.map((lead) => lead.email));
    }

    const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    const job = await prisma.emailVerificationJob.create({
      data: {
        workspaceId: input.workspaceId,
        initiatedByUserId: input.initiatedByUserId ?? null,
        source: input.source,
        name: input.name ?? null,
        total: uniqueEmails.length,
        pending: uniqueEmails.length,
        metadata: {
          ...(input.metadata ?? {}),
          leadIds: input.leadIds ?? [],
        },
        status: 'PENDING',
      },
    });

    const queue = getVerificationQueue();
    // Enqueue in bulk chunks (one Redis round trip each) rather than awaiting a
    // per-email add, so a large upload returns quickly instead of blocking the
    // request until every email is queued.
    for (let i = 0; i < uniqueEmails.length; i += ENQUEUE_CHUNK_SIZE) {
      const chunk = uniqueEmails.slice(i, i + ENQUEUE_CHUNK_SIZE);
      await enqueueEmailVerificationBatch(
        queue,
        chunk.map((email) => ({ jobId: job.id, workspaceId: input.workspaceId, email })),
      );
    }

    await prisma.emailVerificationJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    return job;
  }

  async incrementCounter(jobId: string, status: string, failed = false): Promise<void> {
    const field = statusCounterField(status);
    await prisma.emailVerificationJob.update({
      where: { id: jobId },
      data: {
        completed: { increment: 1 },
        pending: { decrement: 1 },
        ...(failed ? { failedCount: { increment: 1 } } : {}),
        ...(field ? { [field]: { increment: 1 } } : {}),
      },
    });

    const job = await prisma.emailVerificationJob.findUnique({ where: { id: jobId } });
    if (job && job.pending <= 0 && job.status === 'RUNNING') {
      await prisma.emailVerificationJob.update({
        where: { id: jobId },
        data: {
          status: job.failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
          completedAt: new Date(),
          pending: 0,
        },
      });
    }
  }

  async getJob(jobId: string, workspaceId: string) {
    return prisma.emailVerificationJob.findFirst({
      where: { id: jobId, workspaceId },
    });
  }

  async listJobs(workspaceId: string, options?: { page?: number; limit?: number }) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.emailVerificationJob.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailVerificationJob.count({ where: { workspaceId } }),
    ]);

    return { data, total, page, limit };
  }

  async pauseJob(jobId: string, workspaceId: string): Promise<{ count: number }> {
    return prisma.emailVerificationJob.updateMany({
      where: { id: jobId, workspaceId, status: 'RUNNING' },
      data: { status: 'PAUSED' },
    });
  }

  async resumeJob(jobId: string, workspaceId: string) {
    const job = await prisma.emailVerificationJob.findFirst({
      where: { id: jobId, workspaceId, status: 'PAUSED' },
    });
    if (!job) return { count: 0 };

    await prisma.emailVerificationJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING' },
    });

    return { count: 1 };
  }

  async cancelJob(jobId: string, workspaceId: string): Promise<{ count: number }> {
    return prisma.emailVerificationJob.updateMany({
      where: { id: jobId, workspaceId, status: { in: ['PENDING', 'RUNNING', 'PAUSED'] } },
      data: { status: 'CANCELLED', completedAt: new Date(), pending: 0 },
    });
  }
}

function statusCounterField(status: string): string | null {
  switch (status) {
    case 'VERIFIED':
      return 'validCount';
    case 'INVALID':
      return 'invalidCount';
    case 'RISKY':
      return 'riskyCount';
    case 'UNKNOWN':
      return 'unknownCount';
    case 'DISPOSABLE':
      return 'disposableCount';
    case 'ROLE_BASED':
      return 'roleCount';
    default:
      return null;
  }
}

export const verificationJobService = new VerificationJobService();
