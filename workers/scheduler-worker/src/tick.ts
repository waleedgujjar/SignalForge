import type {
  AnalyticsSchedulerService,
  AnalyticsSchedulerTickResult,
} from '@signalforge/analytics';
import type {
  AutomationSchedulerService,
  AutomationSchedulerTickResult,
} from '@signalforge/automations';
import type {
  DeliverabilitySchedulerService,
  DeliverabilitySchedulerTickResult,
} from '@signalforge/deliverability';
import type { InboxSchedulerService, InboxSchedulerTickResult } from '@signalforge/inbox';
import type { SendingSchedulerService } from '@signalforge/sending';
import type { WarmupSchedulerService, WarmupSchedulerTickResult } from '@signalforge/warmup';

export interface SchedulerTickResult {
  promoted: number;
  dispatched: number;
  deferred: number;
  errors: number;
  warmup: WarmupSchedulerTickResult;
  inbox: InboxSchedulerTickResult;
  deliverability: DeliverabilitySchedulerTickResult;
  analytics: AnalyticsSchedulerTickResult;
  automations: AutomationSchedulerTickResult;
}

export async function runSchedulerTick(
  scheduler: SendingSchedulerService,
  warmupScheduler: WarmupSchedulerService,
  inboxScheduler: InboxSchedulerService,
  deliverabilityScheduler: DeliverabilitySchedulerService,
  analyticsScheduler: AnalyticsSchedulerService,
  automationScheduler: AutomationSchedulerService,
  now: Date = new Date(),
): Promise<SchedulerTickResult> {
  const promoted = await scheduler.promoteScheduledCampaigns(now);
  const dispatch = await scheduler.dispatchDueJobs(now);
  const warmup = await warmupScheduler.runTick(now);
  const inbox = await inboxScheduler.runTick(now);
  const deliverability = await deliverabilityScheduler.runTick(now);
  const analytics = await analyticsScheduler.runTick(now);
  const automations = await automationScheduler.runTick(now);
  return {
    promoted,
    dispatched: dispatch.dispatched,
    deferred: dispatch.deferred,
    errors: dispatch.errors,
    warmup,
    inbox,
    deliverability,
    analytics,
    automations,
  };
}
