import { prisma, type EmailWarmupConfig, type WarmupStatus } from '@signalforge/database';
import { logWarmupEvent } from './activity.js';
import { parseWeekdays } from './eligibility.js';

const DEFAULT_STARTING_LIMIT = 5;
const DEFAULT_MAX_LIMIT = 50;
const DEFAULT_RAMP_STEP = 5;
const DEFAULT_RAMP_INTERVAL_HOURS = 24;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const DEFAULT_WINDOW_START = '09:00';
const DEFAULT_WINDOW_END = '17:00';

export interface WarmupSettingsInput {
  startingDailyLimit?: number;
  maximumDailyLimit?: number;
  rampStep?: number;
  rampIntervalHours?: number;
  timezone?: string;
  weekdays?: number[];
  windowStart?: string;
  windowEnd?: string;
  consecutiveFailureThreshold?: number;
}

export class MailboxNotInWorkspaceError extends Error {
  constructor(mailboxId: string) {
    super(`Mailbox ${mailboxId} not found in workspace`);
    this.name = 'MailboxNotInWorkspaceError';
  }
}

export class InvalidWarmupSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWarmupSettingsError';
  }
}

function validateSettings(
  settings: WarmupSettingsInput,
  accountLimit: number,
): void {
  const start = settings.startingDailyLimit ?? DEFAULT_STARTING_LIMIT;
  const max = settings.maximumDailyLimit ?? DEFAULT_MAX_LIMIT;
  const step = settings.rampStep ?? DEFAULT_RAMP_STEP;
  const interval = settings.rampIntervalHours ?? DEFAULT_RAMP_INTERVAL_HOURS;
  const threshold = settings.consecutiveFailureThreshold ?? DEFAULT_FAILURE_THRESHOLD;

  if (start < 1 || start > 200) {
    throw new InvalidWarmupSettingsError('startingDailyLimit must be between 1 and 200');
  }
  if (max < start) {
    throw new InvalidWarmupSettingsError('maximumDailyLimit must be >= startingDailyLimit');
  }
  if (max > accountLimit) {
    throw new InvalidWarmupSettingsError(
      `maximumDailyLimit (${max}) exceeds mailbox dailySendingLimit (${accountLimit})`,
    );
  }
  if (step < 1 || step > max) {
    throw new InvalidWarmupSettingsError('rampStep must be between 1 and maximumDailyLimit');
  }
  if (interval < 1 || interval > 24 * 14) {
    throw new InvalidWarmupSettingsError('rampIntervalHours must be between 1 and 336');
  }
  if (threshold < 1 || threshold > 20) {
    throw new InvalidWarmupSettingsError('consecutiveFailureThreshold must be between 1 and 20');
  }
  if (settings.weekdays) {
    for (const d of settings.weekdays) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        throw new InvalidWarmupSettingsError('weekdays must be integers 0-6');
      }
    }
    if (settings.weekdays.length === 0) {
      throw new InvalidWarmupSettingsError('weekdays cannot be empty');
    }
  }
  if (settings.windowStart && !/^\d{2}:\d{2}$/.test(settings.windowStart)) {
    throw new InvalidWarmupSettingsError('windowStart must match HH:MM');
  }
  if (settings.windowEnd && !/^\d{2}:\d{2}$/.test(settings.windowEnd)) {
    throw new InvalidWarmupSettingsError('windowEnd must match HH:MM');
  }
}

async function assertMailbox(mailboxId: string, workspaceId: string) {
  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, workspaceId },
    include: { workspace: true },
  });
  if (!mailbox) throw new MailboxNotInWorkspaceError(mailboxId);
  return mailbox;
}

async function syncMailboxStatus(mailboxId: string, status: WarmupStatus): Promise<void> {
  await prisma.mailbox.update({ where: { id: mailboxId }, data: { warmupStatus: status } });
}

export class WarmupConfigService {
  async getConfig(
    mailboxId: string,
    workspaceId: string,
  ): Promise<EmailWarmupConfig | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      select: { id: true },
    });
    if (!mailbox) return null;
    return prisma.emailWarmupConfig.findUnique({ where: { mailboxId } });
  }

  async ensureConfig(
    mailboxId: string,
    workspaceId: string,
  ): Promise<EmailWarmupConfig> {
    const mailbox = await assertMailbox(mailboxId, workspaceId);
    const existing = await prisma.emailWarmupConfig.findUnique({ where: { mailboxId } });
    if (existing) return existing;

    const timezone =
      mailbox.timezone && mailbox.timezone.trim() !== ''
        ? mailbox.timezone
        : mailbox.workspace.timezone || 'UTC';

    return prisma.emailWarmupConfig.create({
      data: {
        workspaceId,
        mailboxId,
        enabled: false,
        status: 'NOT_STARTED',
        startingDailyLimit: DEFAULT_STARTING_LIMIT,
        maximumDailyLimit: Math.min(DEFAULT_MAX_LIMIT, mailbox.dailySendingLimit),
        rampStep: DEFAULT_RAMP_STEP,
        rampIntervalHours: DEFAULT_RAMP_INTERVAL_HOURS,
        currentDailyLimit: DEFAULT_STARTING_LIMIT,
        timezone,
        weekdays: DEFAULT_WEEKDAYS,
        windowStart: DEFAULT_WINDOW_START,
        windowEnd: DEFAULT_WINDOW_END,
        consecutiveFailureThreshold: DEFAULT_FAILURE_THRESHOLD,
      },
    });
  }

  async updateSettings(
    mailboxId: string,
    workspaceId: string,
    settings: WarmupSettingsInput,
  ): Promise<EmailWarmupConfig> {
    const mailbox = await assertMailbox(mailboxId, workspaceId);
    validateSettings(settings, mailbox.dailySendingLimit);
    const existing = await this.ensureConfig(mailboxId, workspaceId);
    const currentLimit = settings.startingDailyLimit
      ? Math.max(settings.startingDailyLimit, existing.currentDailyLimit)
      : existing.currentDailyLimit;
    const nextWeekdays = settings.weekdays ?? parseWeekdays(existing.weekdays);
    return prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        startingDailyLimit: settings.startingDailyLimit ?? existing.startingDailyLimit,
        maximumDailyLimit: settings.maximumDailyLimit ?? existing.maximumDailyLimit,
        rampStep: settings.rampStep ?? existing.rampStep,
        rampIntervalHours: settings.rampIntervalHours ?? existing.rampIntervalHours,
        timezone: settings.timezone ?? existing.timezone,
        weekdays: nextWeekdays,
        windowStart: settings.windowStart ?? existing.windowStart,
        windowEnd: settings.windowEnd ?? existing.windowEnd,
        consecutiveFailureThreshold:
          settings.consecutiveFailureThreshold ?? existing.consecutiveFailureThreshold,
        currentDailyLimit: currentLimit,
      },
    });
  }

  async enable(
    mailboxId: string,
    workspaceId: string,
    settings?: WarmupSettingsInput,
  ): Promise<EmailWarmupConfig> {
    const mailbox = await assertMailbox(mailboxId, workspaceId);
    if (settings) validateSettings(settings, mailbox.dailySendingLimit);
    const existing = await this.ensureConfig(mailboxId, workspaceId);
    const now = new Date();
    const startingLimit = settings?.startingDailyLimit ?? existing.startingDailyLimit;
    const nextWeekdays = settings?.weekdays ?? parseWeekdays(existing.weekdays);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        enabled: true,
        status: 'ACTIVE',
        startingDailyLimit: settings?.startingDailyLimit ?? existing.startingDailyLimit,
        maximumDailyLimit: settings?.maximumDailyLimit ?? existing.maximumDailyLimit,
        rampStep: settings?.rampStep ?? existing.rampStep,
        rampIntervalHours: settings?.rampIntervalHours ?? existing.rampIntervalHours,
        timezone: settings?.timezone ?? existing.timezone,
        weekdays: nextWeekdays,
        windowStart: settings?.windowStart ?? existing.windowStart,
        windowEnd: settings?.windowEnd ?? existing.windowEnd,
        consecutiveFailureThreshold:
          settings?.consecutiveFailureThreshold ?? existing.consecutiveFailureThreshold,
        currentDailyLimit: existing.startDate ? existing.currentDailyLimit : startingLimit,
        consecutiveFailures: 0,
        lastFailureAt: null,
        blockReason: null,
        blockedAt: null,
        pausedAt: null,
        completedAt: null,
        startDate: existing.startDate ?? now,
      },
    });
    await syncMailboxStatus(mailboxId, 'ACTIVE');
    logWarmupEvent('Warmup enabled', {
      workspaceId,
      mailboxId,
      configId: config.id,
      status: 'active',
      currentLimit: config.currentDailyLimit,
    });
    return config;
  }

  async pause(mailboxId: string, workspaceId: string): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: { status: 'PAUSED', enabled: false, pausedAt: new Date() },
    });
    await prisma.warmupJob.updateMany({
      where: {
        mailboxId,
        status: { in: ['QUEUED', 'DISPATCHED'] },
      },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    await syncMailboxStatus(mailboxId, 'PAUSED');
    logWarmupEvent('Warmup paused', { workspaceId, mailboxId, status: 'paused' });
    return config;
  }

  async resume(mailboxId: string, workspaceId: string): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        status: 'ACTIVE',
        enabled: true,
        pausedAt: null,
      },
    });
    await prisma.warmupJob.updateMany({
      where: { mailboxId, status: 'PAUSED' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncMailboxStatus(mailboxId, 'ACTIVE');
    logWarmupEvent('Warmup resumed', {
      workspaceId,
      mailboxId,
      status: 'active',
      currentLimit: config.currentDailyLimit,
    });
    return config;
  }

  async disable(mailboxId: string, workspaceId: string): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: { status: 'DISABLED', enabled: false, pausedAt: new Date() },
    });
    await prisma.warmupJob.updateMany({
      where: {
        mailboxId,
        status: { in: ['QUEUED', 'DISPATCHED', 'PAUSED'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncMailboxStatus(mailboxId, 'DISABLED');
    logWarmupEvent('Warmup disabled', { workspaceId, mailboxId, status: 'disabled' });
    return config;
  }

  async block(
    mailboxId: string,
    workspaceId: string,
    reason: string,
  ): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        status: 'BLOCKED',
        enabled: false,
        blockedAt: new Date(),
        blockReason: reason.slice(0, 500),
      },
    });
    await prisma.warmupJob.updateMany({
      where: { mailboxId, status: { in: ['QUEUED', 'DISPATCHED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncMailboxStatus(mailboxId, 'BLOCKED');
    logWarmupEvent('Warmup blocked', {
      workspaceId,
      mailboxId,
      status: 'blocked',
      reason,
    });
    return config;
  }

  async markCompleted(
    mailboxId: string,
    workspaceId: string,
  ): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        status: 'COMPLETED',
        enabled: false,
        completedAt: new Date(),
      },
    });
    await syncMailboxStatus(mailboxId, 'COMPLETED');
    logWarmupEvent('Warmup completed', {
      workspaceId,
      mailboxId,
      status: 'completed',
      currentLimit: config.currentDailyLimit,
    });
    return config;
  }

  async reset(
    mailboxId: string,
    workspaceId: string,
  ): Promise<EmailWarmupConfig> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        status: 'NOT_STARTED',
        enabled: false,
        currentDailyLimit: DEFAULT_STARTING_LIMIT,
        consecutiveFailures: 0,
        lastFailureAt: null,
        blockReason: null,
        blockedAt: null,
        completedAt: null,
        pausedAt: null,
        startDate: null,
        lastProgressionAt: null,
        resetRequestedAt: new Date(),
      },
    });
    await prisma.warmupJob.updateMany({
      where: { mailboxId, status: { in: ['QUEUED', 'DISPATCHED', 'PAUSED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await syncMailboxStatus(mailboxId, 'NOT_STARTED');
    logWarmupEvent('Warmup reset', { workspaceId, mailboxId, status: 'reset' });
    return config;
  }

  async recordFailure(mailboxId: string, workspaceId: string): Promise<{
    blocked: boolean;
    config: EmailWarmupConfig;
  }> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.findUnique({
      where: { mailboxId },
    });
    if (!config) throw new MailboxNotInWorkspaceError(mailboxId);
    const consecutiveFailures = config.consecutiveFailures + 1;
    const shouldBlock = consecutiveFailures >= config.consecutiveFailureThreshold;
    if (shouldBlock) {
      const updated = await this.block(
        mailboxId,
        workspaceId,
        `Warmup blocked after ${consecutiveFailures} consecutive failures`,
      );
      return { blocked: true, config: updated };
    }
    const updated = await prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: {
        consecutiveFailures,
        lastFailureAt: new Date(),
      },
    });
    return { blocked: false, config: updated };
  }

  async recordSuccess(mailboxId: string, workspaceId: string): Promise<EmailWarmupConfig | null> {
    await assertMailbox(mailboxId, workspaceId);
    const config = await prisma.emailWarmupConfig.findUnique({ where: { mailboxId } });
    if (!config || config.consecutiveFailures === 0) return config;
    return prisma.emailWarmupConfig.update({
      where: { mailboxId },
      data: { consecutiveFailures: 0, lastFailureAt: null },
    });
  }

  async listAccounts(workspaceId: string) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { workspaceId },
      include: { warmupConfig: true, workspace: { select: { timezone: true } } },
      orderBy: { emailAddress: 'asc' },
    });
    return mailboxes;
  }

  getWeekdays(value: unknown): number[] {
    return parseWeekdays(value);
  }
}

export const warmupConfigService = new WarmupConfigService();
