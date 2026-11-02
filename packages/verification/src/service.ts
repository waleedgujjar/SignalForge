import { prisma, type Prisma, type VerificationStatus } from '@signalforge/database';
import {
  emailVerificationEngine,
  isVerificationFresh,
  VERIFICATION_VERSION,
  type VerificationCheck,
  type VerificationResult,
} from '@signalforge/email';
import type { VerifyEmailOptions } from '@signalforge/email';

export interface PersistVerificationInput {
  workspaceId: string;
  leadId?: string;
  jobId?: string;
  result: VerificationResult;
}

export interface VerifyOutcome extends VerificationResult {
  /** True when an earlier, still-fresh result was reused instead of re-probing. */
  cached: boolean;
  verifiedAt: Date;
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export { isVerificationFresh, verificationCacheTtlMs } from '@signalforge/email';

export class EmailVerificationService {
  /**
   * Verifies an address and records the result on every lead in the workspace
   * that has that address, so Leads, Campaigns and the Verify page all agree.
   * A fresh earlier result is reused unless `forceRecheck` is set.
   */
  async verifyAndPersist(
    email: string,
    input: { workspaceId: string; leadId?: string; jobId?: string; options?: VerifyEmailOptions },
  ): Promise<VerifyOutcome> {
    if (!input.options?.forceRecheck) {
      const cached = await this.findFresh(input.workspaceId, email);
      if (cached) {
        await this.syncLeads(input.workspaceId, cached, input.leadId, cached.verifiedAt);
        // Bulk jobs build their results (progress, export) from history rows.
        if (input.jobId) {
          await this.writeHistory({ workspaceId: input.workspaceId, leadId: input.leadId, jobId: input.jobId, result: cached });
        }
        return cached;
      }
    }

    const result = await emailVerificationEngine.verify(email, input.options);
    const verifiedAt = new Date();
    await this.syncLeads(input.workspaceId, result, input.leadId, verifiedAt);
    await this.writeHistory({ workspaceId: input.workspaceId, leadId: input.leadId, jobId: input.jobId, result });
    return { ...result, cached: false, verifiedAt };
  }

  /** Latest fresh result for this address in the workspace, if any. */
  async findFresh(workspaceId: string, email: string): Promise<VerifyOutcome | null> {
    const row = await prisma.leadVerification.findFirst({
      where: { workspaceId, normalizedEmail: emailKey(email), verificationVersion: VERIFICATION_VERSION },
      orderBy: { verifiedAt: 'desc' },
    });
    if (!row || !isVerificationFresh(row)) return null;
    return { ...rowToResult(row), cached: true, verifiedAt: row.verifiedAt! };
  }

  async persistLeadVerification(input: PersistVerificationInput): Promise<VerificationResult> {
    const { workspaceId, leadId, jobId, result } = input;
    await this.syncLeads(workspaceId, result, leadId, new Date());
    await this.writeHistory({ workspaceId, leadId, jobId, result });
    return result;
  }

  /**
   * Upserts the result onto the given lead and every other lead in the
   * workspace with the same address (leads are unique per exact email string,
   * so differently-cased copies can coexist).
   */
  private async syncLeads(
    workspaceId: string,
    result: VerificationResult,
    leadId: string | undefined,
    verifiedAt: Date,
  ): Promise<void> {
    const key = emailKey(result.email);
    const variants = [...new Set([key, result.originalEmail.trim(), result.email])];
    const leads = await prisma.lead.findMany({
      where: { workspaceId, email: { in: variants } },
      select: { id: true },
    });
    const ids = new Set(leads.map((l) => l.id));
    if (leadId) ids.add(leadId);

    for (const id of ids) {
      const data = toLeadVerificationData(result, verifiedAt);
      await prisma.leadVerification.upsert({
        where: { leadId: id },
        create: { lead: { connect: { id } }, workspaceId, ...data },
        update: data,
      });
    }
  }

  async writeHistory(input: {
    workspaceId: string;
    leadId?: string;
    jobId?: string;
    result: VerificationResult;
  }): Promise<void> {
    await prisma.emailVerificationHistory.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId ?? null,
        jobId: input.jobId ?? null,
        email: input.result.email,
        normalizedEmail: emailKey(input.result.normalizedEmail),
        status: input.result.status as VerificationStatus,
        riskScore: input.result.riskScore,
        confidenceScore: input.result.confidenceScore,
        verificationMethod: input.result.verificationMethod,
        reasonCode: input.result.reasonCode,
        reasonMessage: input.result.reason,
        checks: input.result.checks as unknown as Prisma.InputJsonValue,
        smtpResponse: input.result.smtpResponse,
        checkedAt: new Date(),
      },
    });
  }
}

function toLeadVerificationData(result: VerificationResult, verifiedAt: Date) {
  return {
    email: result.email,
    originalEmail: result.originalEmail,
    normalizedEmail: emailKey(result.normalizedEmail),
    status: result.status as VerificationStatus,
    score: result.score,
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    confidenceScore: result.confidenceScore,
    reason: result.reason,
    reasonCode: result.reasonCode,
    domain: result.domain,
    mxStatus: result.mxStatus,
    syntaxValid: result.syntaxValid,
    domainValid: result.domainValid,
    dnsResolved: result.dnsResolved,
    mxFound: result.mxFound,
    mxRecords: result.mxRecords as unknown as Prisma.InputJsonValue,
    smtpStatus: result.smtpStatus,
    smtpResponse: result.smtpResponse,
    isDisposable: result.isDisposable,
    isRole: result.isRole,
    roleType: result.roleType,
    isCatchAll: result.isCatchAll,
    providerType: result.providerType,
    verificationMethod: result.verificationMethod,
    riskFactors: result.riskFactors as Prisma.InputJsonValue,
    checks: result.checks as unknown as Prisma.InputJsonValue,
    verificationVersion: result.verificationVersion,
    verifiedAt,
  } satisfies Omit<Prisma.LeadVerificationCreateInput, 'lead' | 'workspaceId'>;
}

type LeadVerificationRow = NonNullable<Awaited<ReturnType<typeof prisma.leadVerification.findFirst>>>;

function rowToResult(row: LeadVerificationRow): VerificationResult {
  return {
    email: row.email,
    originalEmail: row.originalEmail ?? row.email,
    normalizedEmail: row.normalizedEmail ?? emailKey(row.email),
    status: row.status as VerificationResult['status'],
    score: row.score,
    riskScore: row.riskScore ?? 0,
    riskLevel: (row.riskLevel ?? 'LOW') as VerificationResult['riskLevel'],
    confidenceScore: row.confidenceScore ?? row.score,
    reason: row.reason ?? '',
    reasonCode: row.reasonCode ?? '',
    domain: row.domain ?? '',
    mxStatus: row.mxStatus ?? '',
    syntaxValid: row.syntaxValid ?? false,
    domainValid: row.domainValid ?? false,
    dnsResolved: row.dnsResolved ?? false,
    mxFound: row.mxFound ?? false,
    mxRecords: (row.mxRecords ?? []) as unknown as VerificationResult['mxRecords'],
    smtpStatus: (row.smtpStatus ?? 'SKIPPED') as VerificationResult['smtpStatus'],
    isDisposable: row.isDisposable,
    isRole: row.isRole,
    roleType: row.roleType,
    isCatchAll: row.isCatchAll,
    providerType: (row.providerType ?? 'UNKNOWN') as VerificationResult['providerType'],
    verificationMethod: (row.verificationMethod ?? 'COMBINED') as VerificationResult['verificationMethod'],
    riskFactors: (row.riskFactors ?? []) as string[],
    checks: (row.checks ?? []) as unknown as VerificationCheck[],
    smtpResponse: row.smtpResponse,
    verificationVersion: row.verificationVersion,
  };
}

export const emailVerificationService = new EmailVerificationService();
