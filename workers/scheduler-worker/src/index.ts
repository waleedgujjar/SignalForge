import './load-env.js';

import { AnalyticsSchedulerService } from '@signalforge/analytics';
import { automationSchedulerService } from '@signalforge/automations';
import { loadEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import { DeliverabilitySchedulerService } from '@signalforge/deliverability';
import { InboxSchedulerService } from '@signalforge/inbox';
import {
  QUEUE_NAMES,
  createQueue,
  createRedisConnection,
  registerWorkerShutdown,
  recoverStuckDiscoveryJobs,
  recoverStuckVerificationJobs,
  type AnalyticsAggregationPayload,
  type DeliverabilityAggregationPayload,
  type DomainHealthCheckPayload,
  type EmailSendQueuePayload,
  type InboundSyncQueuePayload,
  type WarmupQueuePayload,
} from '@signalforge/queue';
import { SendingSchedulerService } from '@signalforge/sending';
import { WarmupSchedulerService } from '@signalforge/warmup';
import { runSchedulerTick, type SchedulerTickResult } from './tick.js';

const TICK_INTERVAL_MS = 30_000;
const RECOVERY_INTERVAL_MS = 5 * 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ worker: 'scheduler-worker', message, ...meta, timestamp: new Date().toISOString() }));
}

async function startWorker(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const emailSendQueue = createQueue<EmailSendQueuePayload>(QUEUE_NAMES.EMAIL_SEND, connection);
  const warmupQueue = createQueue<WarmupQueuePayload>(QUEUE_NAMES.WARMUP, connection);
  const inboxSyncQueue = createQueue<InboundSyncQueuePayload>(QUEUE_NAMES.EMAIL_INBOUND, connection);
  const aggregationQueue = createQueue<DeliverabilityAggregationPayload>(
    QUEUE_NAMES.DELIVERABILITY_AGGREGATION,
    connection,
  );
  const domainCheckQueue = createQueue<DomainHealthCheckPayload>(
    QUEUE_NAMES.DOMAIN_HEALTH_CHECK,
    connection,
  );
  const analyticsQueue = createQueue<AnalyticsAggregationPayload>(
    QUEUE_NAMES.ANALYTICS,
    connection,
  );
  const scheduler = new SendingSchedulerService(emailSendQueue);
  const warmupScheduler = new WarmupSchedulerService(warmupQueue);
  const inboxScheduler = new InboxSchedulerService(inboxSyncQueue);
  const deliverabilityScheduler = new DeliverabilitySchedulerService(
    aggregationQueue,
    domainCheckQueue,
  );
  const analyticsScheduler = new AnalyticsSchedulerService(analyticsQueue);

  let stopping = false;
  const tickTimer = setInterval(() => {
    if (stopping) return;
    void runSchedulerTick(
      scheduler,
      warmupScheduler,
      inboxScheduler,
      deliverabilityScheduler,
      analyticsScheduler,
      automationSchedulerService,
    )
      .then((result: SchedulerTickResult) => {
        const hasCampaignActivity =
          result.promoted > 0 || result.dispatched > 0 || result.deferred > 0 || result.errors > 0;
        const hasWarmupActivity =
          result.warmup.planned > 0 ||
          result.warmup.progressed > 0 ||
          result.warmup.completed > 0 ||
          result.warmup.dispatched > 0 ||
          result.warmup.deferred > 0 ||
          result.warmup.errors > 0;
        const hasInboxActivity =
          result.inbox.scheduled > 0 ||
          result.inbox.dispatched > 0 ||
          result.inbox.deferred > 0 ||
          result.inbox.errors > 0;
        const hasDeliverabilityActivity =
          result.deliverability.aggregationsQueued > 0 || result.deliverability.domainChecksQueued > 0;
        const hasAnalyticsActivity = result.analytics.aggregationsQueued > 0;
        const hasAutomationsActivity = result.automations.resumed > 0 || result.automations.errors > 0;
        if (
          hasCampaignActivity ||
          hasWarmupActivity ||
          hasInboxActivity ||
          hasDeliverabilityActivity ||
          hasAnalyticsActivity ||
          hasAutomationsActivity
        ) {
          log('Scheduler tick complete', {
            promoted: result.promoted,
            dispatched: result.dispatched,
            deferred: result.deferred,
            errors: result.errors,
            warmup: result.warmup,
            inbox: result.inbox,
            deliverability: result.deliverability,
            analytics: result.analytics,
            automations: result.automations,
          });
        }
      })
      .catch((error) => {
        log('Scheduler tick error', { error: error instanceof Error ? error.message : String(error) });
      });
  }, TICK_INTERVAL_MS);

  const recoveryTimer = setInterval(() => {
    if (stopping) return;
    void scheduler
      .recoverMissedJobs()
      .then((recovered) => {
        if (recovered > 0) {
          log('Recovered missed sending jobs', { recovered });
        }
      })
      .catch((error) => {
        log('Sending recovery error', { error: error instanceof Error ? error.message : String(error) });
      });

    void recoverStuckDiscoveryJobs()
      .then((recovered) => {
        if (recovered > 0) {
          log('Recovered stuck discovery jobs', { recovered });
        }
      })
      .catch((error) => {
        log('Discovery recovery error', { error: error instanceof Error ? error.message : String(error) });
      });

    void resetMailboxDailyUsage()
      .then((reset) => {
        if (reset > 0) log('Reset daily usage for new day', { mailboxes: reset });
      })
      .catch((error) => {
        log('Daily usage reset error', { error: error instanceof Error ? error.message : String(error) });
      });

    void recoverStuckVerificationJobs()
      .then((recovered) => {
        if (recovered > 0) {
          log('Recovered stuck verification jobs', { recovered });
        }
      })
      .catch((error) => {
        log('Verification recovery error', { error: error instanceof Error ? error.message : String(error) });
      });
  }, RECOVERY_INTERVAL_MS);

  /**
   * Resets Mailbox.currentDailyUsage (the "sent today" figure shown in the UI)
   * once a mailbox's local day has rolled over, so idle mailboxes do not keep
   * showing yesterday's count. Sending capacity itself is enforced from
   * MailboxDailyUsage and does not depend on this.
   */
  async function resetMailboxDailyUsage(): Promise<number> {
    const mailboxes = await prisma.mailbox.findMany({
      where: { currentDailyUsage: { gt: 0 } },
      select: { id: true, timezone: true, usageResetAt: true, workspace: { select: { timezone: true } } },
    });
    const now = new Date();
    const stale = mailboxes.filter((m) => {
      const tz = m.timezone ?? m.workspace.timezone ?? 'UTC';
      return localDate(m.usageResetAt, tz) !== localDate(now, tz);
    });
    if (stale.length === 0) return 0;
    const result = await prisma.mailbox.updateMany({
      where: { id: { in: stale.map((m) => m.id) } },
      data: { currentDailyUsage: 0, usageResetAt: now },
    });
    return result.count;
  }

  async function cleanupExpiredRecords(): Promise<void> {
    const now = new Date();
    const [sessions, resetTokens, verificationTokens] = await Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    const total = sessions.count + resetTokens.count + verificationTokens.count;
    if (total > 0) {
      log('Cleaned up expired records', {
        sessions: sessions.count,
        resetTokens: resetTokens.count,
        verificationTokens: verificationTokens.count,
      });
    }
  }

  void cleanupExpiredRecords().catch((error) => {
    log('Initial cleanup error', { error: error instanceof Error ? error.message : String(error) });
  });

  const cleanupTimer = setInterval(() => {
    if (stopping) return;
    void cleanupExpiredRecords().catch((error) => {
      log('Cleanup error', { error: error instanceof Error ? error.message : String(error) });
    });
  }, CLEANUP_INTERVAL_MS);

  registerWorkerShutdown([], {
    onShutdown: async () => {
      stopping = true;
      clearInterval(tickTimer);
      clearInterval(recoveryTimer);
      clearInterval(cleanupTimer);
      await emailSendQueue.close();
      await warmupQueue.close();
      await inboxSyncQueue.close();
      await aggregationQueue.close();
      await domainCheckQueue.close();
      await analyticsQueue.close();
    },
  });

  log('Scheduler worker ready', { tickIntervalMs: TICK_INTERVAL_MS, recoveryIntervalMs: RECOVERY_INTERVAL_MS, cleanupIntervalMs: CLEANUP_INTERVAL_MS });
}

void startWorker().catch((error) => {
  console.error('Failed to start scheduler worker', error);
  process.exit(1);
});

/** Calendar date (YYYY-MM-DD) of `at` in `timeZone`, falling back to UTC. */
function localDate(at: Date, timeZone: string): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
}
