import { z } from 'zod';
import type {
  BounceType,
  DeliverabilityAlertSeverity,
  DeliverabilityAlertType,
  DeliverabilityEntityType,
  DeliverabilityProtectionLevel,
  DeliveryEventSource,
  DeliveryEventType,
  DnsCheckStatus,
  RecipientBounceStatus,
} from '@signalforge/database';

export type {
  BounceType,
  DeliverabilityAlertSeverity,
  DeliverabilityAlertType,
  DeliverabilityEntityType,
  DeliverabilityProtectionLevel,
  DeliveryEventSource,
  DeliveryEventType,
  DnsCheckStatus,
  RecipientBounceStatus,
};

/// Score tiers shown in the UI. Thresholds are workspace-configurable; these
/// bounds are the conservative defaults.
export type HealthTier = 'EXCELLENT' | 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'CRITICAL';

export const healthTierThresholdsSchema = z.object({
  excellent: z.number().int().min(0).max(100).default(90),
  healthy: z.number().int().min(0).max(100).default(75),
  needsAttention: z.number().int().min(0).max(100).default(60),
  atRisk: z.number().int().min(0).max(100).default(40),
});

export const deliverabilityThresholdsSchema = z.object({
  ...healthTierThresholdsSchema.shape,
  /// Percentage of attempted sends that bounced before a mailbox is treated as critical.
  criticalBounceRatePercent: z.number().min(0).max(100).default(5),
  warningBounceRatePercent: z.number().min(0).max(100).default(2),
  criticalFailureRatePercent: z.number().min(0).max(100).default(3),
  warningFailureRatePercent: z.number().min(0).max(100).default(1),
  warningUnsubscribeRatePercent: z.number().min(0).max(100).default(1),
  /// Consecutive soft bounces to the same recipient before it is marked AT_RISK.
  softBounceThreshold: z.number().int().min(1).max(20).default(3),
  /// Soft bounces after which the recipient is suppressed (0 disables).
  softBounceSuppressThreshold: z.number().int().min(0).max(50).default(6),
  /// Minimum attempted sends before rate-based rules can trigger, to avoid
  /// flagging a mailbox on a handful of sends.
  minimumVolumeForRates: z.number().int().min(1).default(20),
  /// Sending velocity multiplier vs the trailing baseline that counts as unusual.
  velocityAnomalyMultiplier: z.number().min(1).default(3),
  /// Cache lifetime for DNS authentication results.
  dnsCacheTtlHours: z.number().int().min(1).max(168).default(24),
  /// Minimum interval between manual DNS re-checks for the same domain.
  dnsRecheckCooldownMinutes: z.number().int().min(1).default(15),
});

export const deliverabilityProtectionSchema = z.object({
  pauseOnCriticalBounceRate: z.boolean().default(true),
  pauseLeadOnHardBounce: z.boolean().default(true),
  stopOnUnsubscribed: z.boolean().default(true),
  reduceSendingOnCritical: z.boolean().default(true),
  blockRecipientsAtRisk: z.boolean().default(true),
});

export const healthScoreWeightsSchema = z.object({
  delivery: z.number().min(0).default(25),
  bounce: z.number().min(0).default(25),
  failure: z.number().min(0).default(15),
  reply: z.number().min(0).default(10),
  unsubscribe: z.number().min(0).default(10),
  configuration: z.number().min(0).default(5),
  warmup: z.number().min(0).default(5),
  velocity: z.number().min(0).default(5),
});

export const deliverabilityPolicySchema = z.object({
  protection: deliverabilityProtectionSchema,
  thresholds: deliverabilityThresholdsSchema,
  weights: healthScoreWeightsSchema,
});

export type DeliverabilityThresholds = z.infer<typeof deliverabilityThresholdsSchema>;
export type DeliverabilityProtection = z.infer<typeof deliverabilityProtectionSchema>;
export type HealthScoreWeights = z.infer<typeof healthScoreWeightsSchema>;
export type DeliverabilityPolicy = z.infer<typeof deliverabilityPolicySchema>;

export const DEFAULT_THRESHOLDS: DeliverabilityThresholds = deliverabilityThresholdsSchema.parse({});
export const DEFAULT_PROTECTION: DeliverabilityProtection = deliverabilityProtectionSchema.parse({});
export const DEFAULT_WEIGHTS: HealthScoreWeights = healthScoreWeightsSchema.parse({});
export const DEFAULT_POLICY: DeliverabilityPolicy = {
  protection: DEFAULT_PROTECTION,
  thresholds: DEFAULT_THRESHOLDS,
  weights: DEFAULT_WEIGHTS,
};

/// Raw counters for one entity over one time window. Every rate in the product
/// is derived from this shape so the numbers agree across screens.
export interface DeliveryCounters {
  attempted: number;
  sent: number;
  delivered: number;
  bounced: number;
  hardBounces: number;
  softBounces: number;
  failed: number;
  replies: number;
  uniqueRepliedLeads: number;
  unsubscribes: number;
  complaints: number;
  complaintDataAvailable: boolean;
}

export interface DeliveryRates {
  deliveryRate: number;
  bounceRate: number;
  hardBounceRate: number;
  failureRate: number;
  replyRate: number;
  unsubscribeRate: number;
  complaintRate: number | null;
}

export interface HealthScoreComponent {
  key: keyof HealthScoreWeights;
  label: string;
  weight: number;
  /// 0..1 normalized component health.
  normalized: number;
  points: number;
  detail: string;
}

export interface HealthScoreResult {
  score: number;
  tier: HealthTier;
  protectionLevel: DeliverabilityProtectionLevel;
  components: HealthScoreComponent[];
}

export interface DomainAuthResult {
  domain: string;
  spfStatus: DnsCheckStatus;
  dkimStatus: DnsCheckStatus;
  dmarcStatus: DnsCheckStatus;
  mxStatus: DnsCheckStatus;
  spfRecord: string | null;
  dmarcPolicy: string | null;
  dkimSelectors: Array<{ selector: string; status: DnsCheckStatus; record: string | null }>;
  lastError: string | null;
  checkedAt: Date;
}

export type DeliverabilityBlockReason =
  | 'MAILBOX_CRITICAL_HEALTH'
  | 'MAILBOX_PAUSED'
  | 'RECIPIENT_SUPPRESSED'
  | 'RECIPIENT_SOFT_BOUNCE_AT_RISK';

export interface ProtectionEvaluation {
  level: DeliverabilityProtectionLevel;
  reason: string | null;
  shouldPauseMailbox: boolean;
  recommendations: string[];
}

export interface VelocitySnapshot {
  today: number;
  dailyLimit: number;
  lastHour: number;
  last15Minutes: number;
  baselinePerDay: number;
  anomalyDetected: boolean;
  anomalyDescription: string | null;
}
