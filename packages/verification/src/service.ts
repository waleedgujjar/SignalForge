import { prisma, type Prisma, type VerificationStatus } from '@signalforge/database';
import {
  emailVerificationEngine,
  type VerificationResult,
} from '@signalforge/email';
import type { VerifyEmailOptions } from '@signalforge/email';

export interface PersistVerificationInput {
  workspaceId: string;
  leadId?: string;
  jobId?: string;
  result: VerificationResult;
}

export class EmailVerificationService {
  async verifyAndPersist(
    email: string,
    input: { workspaceId: string; leadId?: string; jobId?: string; options?: VerifyEmailOptions },
  ): Promise<VerificationResult> {
    let result = await emailVerificationEngine.verify(email, input.options);

    if (input.leadId) {
      result = await this.persistLeadVerification({
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        jobId: input.jobId,
        result,
      });
    } else {
      await this.writeHistory({
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        result,
      });
    }

    return result;
  }

  async persistLeadVerification(input: PersistVerificationInput): Promise<VerificationResult> {
    const { workspaceId, leadId, jobId, result } = input;
    if (!leadId) {
      await this.writeHistory({ workspaceId, jobId, result });
      return result;
    }

    await prisma.leadVerification.upsert({
      where: { leadId },
      create: this.toLeadVerificationCreate(leadId, workspaceId, result),
      update: this.toLeadVerificationUpdate(result),
    });

    await this.writeHistory({ workspaceId, leadId, jobId, result });
    return result;
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
        normalizedEmail: input.result.normalizedEmail,
        status: input.result.status as VerificationStatus,
        riskScore: input.result.riskScore,
        confidenceScore: input.result.confidenceScore,
        verificationMethod: input.result.verificationMethod,
        reasonCode: input.result.reasonCode,
        reasonMessage: input.result.reason,
        checkedAt: new Date(),
      },
    });
  }

  private toLeadVerificationCreate(
    leadId: string,
    workspaceId: string,
    result: VerificationResult,
  ): Prisma.LeadVerificationCreateInput {
    return {
      lead: { connect: { id: leadId } },
      workspaceId,
      email: result.email,
      originalEmail: result.originalEmail,
      normalizedEmail: result.normalizedEmail,
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
      isDisposable: result.isDisposable,
      isRole: result.isRole,
      roleType: result.roleType,
      isCatchAll: result.isCatchAll,
      providerType: result.providerType,
      verificationMethod: result.verificationMethod,
      riskFactors: result.riskFactors as Prisma.InputJsonValue,
      verificationVersion: result.verificationVersion,
      verifiedAt: new Date(),
    };
  }

  private toLeadVerificationUpdate(result: VerificationResult): Prisma.LeadVerificationUpdateInput {
    return {
      email: result.email,
      originalEmail: result.originalEmail,
      normalizedEmail: result.normalizedEmail,
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
      isDisposable: result.isDisposable,
      isRole: result.isRole,
      roleType: result.roleType,
      isCatchAll: result.isCatchAll,
      providerType: result.providerType,
      verificationMethod: result.verificationMethod,
      riskFactors: result.riskFactors as Prisma.InputJsonValue,
      verificationVersion: result.verificationVersion,
      verifiedAt: new Date(),
    };
  }
}

export const emailVerificationService = new EmailVerificationService();
