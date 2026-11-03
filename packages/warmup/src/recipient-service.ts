import { prisma, type WarmupRecipient } from '@signalforge/database';
import { verifyEmail } from '@signalforge/email';

/// Best-effort verification of a recipient address before it is used for warmup.
/// Returns the verification status (or null if the check could not run) — an
/// inconclusive result never blocks adding the recipient; only INVALID disables it.
async function verifyRecipient(email: string): Promise<{ status: string | null; invalid: boolean }> {
  try {
    const result = await verifyEmail(email);
    return { status: result.status, invalid: result.status === 'INVALID' };
  } catch {
    return { status: null, invalid: false };
  }
}

export interface CreateWarmupRecipientInput {
  workspaceId: string;
  email: string;
  name?: string | null;
  consentConfirmed: boolean;
}

export interface UpdateWarmupRecipientInput {
  enabled?: boolean;
  name?: string | null;
  consentConfirmed?: boolean;
}

export class RecipientConsentRequiredError extends Error {
  constructor() {
    super('Warmup recipient consent must be confirmed before adding');
    this.name = 'RecipientConsentRequiredError';
  }
}

export class InvalidRecipientEmailError extends Error {
  constructor(email: string) {
    super(`Invalid recipient email: ${email}`);
    this.name = 'InvalidRecipientEmailError';
  }
}

export class RecipientAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`Warmup recipient ${email} already exists in this workspace`);
    this.name = 'RecipientAlreadyExistsError';
  }
}

export class RecipientNotFoundError extends Error {
  constructor(id: string) {
    super(`Warmup recipient ${id} not found`);
    this.name = 'RecipientNotFoundError';
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class WarmupRecipientService {
  async list(workspaceId: string): Promise<WarmupRecipient[]> {
    return prisma.warmupRecipient.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(input: CreateWarmupRecipientInput): Promise<WarmupRecipient> {
    const email = normalizeEmail(input.email);
    if (!EMAIL_REGEX.test(email)) throw new InvalidRecipientEmailError(input.email);
    if (!input.consentConfirmed) throw new RecipientConsentRequiredError();
    const existing = await prisma.warmupRecipient.findUnique({
      where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
    });
    if (existing) throw new RecipientAlreadyExistsError(email);
    // Verify the address before use; a confirmed-invalid address is stored but
    // disabled so warmup never sends to a dead mailbox.
    const verification = await verifyRecipient(email);
    return prisma.warmupRecipient.create({
      data: {
        workspaceId: input.workspaceId,
        email,
        name: input.name?.trim() || null,
        enabled: !verification.invalid,
        consentConfirmed: true,
        verificationStatus: verification.status,
        verifiedAt: verification.status ? new Date() : null,
      },
    });
  }

  /// Re-run verification for a recipient (e.g. after an address is fixed).
  async verify(workspaceId: string, id: string): Promise<WarmupRecipient> {
    const existing = await prisma.warmupRecipient.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new RecipientNotFoundError(id);
    const verification = await verifyRecipient(existing.email);
    return prisma.warmupRecipient.update({
      where: { id },
      data: {
        verificationStatus: verification.status,
        verifiedAt: verification.status ? new Date() : existing.verifiedAt,
        ...(verification.invalid ? { enabled: false } : {}),
      },
    });
  }

  async update(
    workspaceId: string,
    id: string,
    input: UpdateWarmupRecipientInput,
  ): Promise<WarmupRecipient> {
    const existing = await prisma.warmupRecipient.findFirst({
      where: { id, workspaceId },
    });
    if (!existing) throw new RecipientNotFoundError(id);
    return prisma.warmupRecipient.update({
      where: { id },
      data: {
        enabled: input.enabled ?? existing.enabled,
        name: input.name === undefined ? existing.name : input.name?.trim() || null,
        consentConfirmed: input.consentConfirmed ?? existing.consentConfirmed,
      },
    });
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const existing = await prisma.warmupRecipient.findFirst({
      where: { id, workspaceId },
    });
    if (!existing) throw new RecipientNotFoundError(id);
    await prisma.warmupRecipient.delete({ where: { id } });
  }

  async countEligible(workspaceId: string): Promise<number> {
    return prisma.warmupRecipient.count({
      where: { workspaceId, enabled: true, consentConfirmed: true },
    });
  }
}

export const warmupRecipientService = new WarmupRecipientService();
