import { prisma, type WarmupRecipient } from '@signalforge/database';

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
    return prisma.warmupRecipient.create({
      data: {
        workspaceId: input.workspaceId,
        email,
        name: input.name?.trim() || null,
        enabled: true,
        consentConfirmed: true,
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
