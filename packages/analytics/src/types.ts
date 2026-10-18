import type {
  DeliveryCounters,
  DeliveryRates,
  TrendDirection,
} from '@signalforge/deliverability';
import type {
  LeadOutcomeSource,
  LeadOutcomeType,
  ReplyClassification,
} from '@signalforge/database';

export type { DeliveryCounters, DeliveryRates, TrendDirection };
export type { LeadOutcomeSource, LeadOutcomeType, ReplyClassification };

/// Preset windows offered in the date picker. `custom` requires explicit dates.
export type AnalyticsPeriod = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsRange {
  from: Date;
  to: Date;
  period: AnalyticsPeriod;
  /// Whole days covered, used to size the comparison window and bucket charts.
  days: number;
}

export interface AnalyticsFilters {
  campaignId?: string;
  mailboxId?: string;
  source?: string;
  industry?: string;
  country?: string;
}

/**
 * Below these volumes a rate is statistically meaningless, so the UI shows
 * "Insufficient data" instead of a percentage. Guarding here rather than in the
 * frontend keeps exports, insights, and charts consistent with each other.
 */
export const MIN_SENDS_FOR_RATE = 20;
export const MIN_LEADS_FOR_RATE = 10;

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  direction: TrendDirection;
}

/// A rate plus the context needed to render it honestly.
export interface RateValue {
  /// Percentage, or null when the denominator is below the minimum sample size.
  value: number | null;
  numerator: number;
  denominator: number;
  /// Human-readable name of the denominator, e.g. "contacted leads".
  denominatorLabel: string;
  sufficientData: boolean;
}

export type FunnelStage =
  | 'IMPORTED'
  | 'VERIFIED'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'POSITIVE_REPLY'
  | 'MEETING';

export interface FunnelStep {
  stage: FunnelStage;
  label: string;
  count: number;
  /// Conversion from the previous stage.
  conversionFromPrevious: RateValue | null;
  /// Conversion from the first stage in the funnel.
  conversionFromTop: RateValue | null;
  dropOff: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  /// Explains how each stage is derived so the numbers are auditable.
  definitions: Record<FunnelStage, string>;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  /// Present only when a comparable previous period exists.
  trend: MetricTrend | null;
  /// Set when the KPI cannot be measured, e.g. meetings without any logged outcome.
  note?: string;
}

export interface TimelinePoint {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  replies: number;
  unsubscribes: number;
  deliveryRate: number;
  bounceRate: number;
  replyRate: number;
}

export interface DimensionRow {
  key: string;
  label: string;
  leads: number;
  contacted: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  replyRate: RateValue;
  positiveReplyRate: RateValue;
}

export interface CampaignAnalyticsRow {
  campaignId: string;
  name: string;
  status: string;
  enrolledLeads: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
  positiveReplies: number;
  meetings: number;
  positiveReplyRate: RateValue;
}

export interface SequenceStepRow {
  stepId: string;
  campaignId: string;
  campaignName: string;
  order: number;
  subject: string;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface SubjectRow {
  subject: string;
  sent: number;
  replies: number;
  replyRate: RateValue;
}

export interface MailboxAnalyticsRow {
  mailboxId: string;
  emailAddress: string;
  poolNames: string[];
  healthScore: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface SmtpPoolRow {
  poolId: string;
  name: string;
  mailboxCount: number;
  counters: DeliveryCounters;
  rates: DeliveryRates;
}

export interface ReplyAnalytics {
  totalReplies: number;
  uniqueRepliedLeads: number;
  breakdown: Array<{ classification: ReplyClassification | 'UNCLASSIFIED'; count: number }>;
  positive: number;
  negative: number;
  outOfOffice: number;
  unsubscribes: number;
  /// Two denominators because both readings are defensible and mean different things.
  positiveRateOfReplies: RateValue;
  positiveRateOfContacted: RateValue;
  responseTime: {
    averageHours: number | null;
    medianHours: number | null;
    sampleSize: number;
  };
}

export interface MeetingAnalytics {
  booked: number;
  bySource: Array<{ source: LeadOutcomeSource; count: number }>;
  meetingRateOfPositiveReplies: RateValue;
  meetingRateOfContacted: RateValue;
  /// True until a calendar integration exists; drives the UI explainer.
  manualEntryOnly: boolean;
}

export interface VerificationAnalytics {
  total: number;
  verified: number;
  invalid: number;
  risky: number;
  unknown: number;
  disposable: number;
  roleBased: number;
  verificationRate: RateValue;
}

export interface WebsiteIntelligenceAnalytics {
  analyzed: number;
  byPriority: Array<{ priority: string; count: number }>;
  byScoreBucket: Array<{ bucket: string; count: number }>;
  averageWebsiteScore: number | null;
  averageOpportunityScore: number | null;
}

export interface ImportAnalytics {
  totalImports: number;
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  bySource: Array<{ source: string; imports: number; imported: number }>;
  /// CSV uploads are processed inline and leave no LeadImport row.
  coverageNote: string;
}

export interface DiscoveryAnalytics {
  totalJobs: number;
  completed: number;
  failed: number;
  cancelled: number;
  partial: number;
  running: number;
  businessesDiscovered: number;
  uniqueLeads: number;
  duplicatesRemoved: number;
  leadsPromoted: number;
  leadsQualified: number;
  enriched: number;
  emailsFound: number;
  emailsVerified: number;
  bySource: Array<{
    source: string;
    jobs: number;
    discovered: number;
    promoted: number;
    qualified: number;
  }>;
}

export interface WarmupAnalytics {
  scheduled: number;
  attempted: number;
  sent: number;
  failed: number;
  deferred: number;
  mailboxesWarming: number;
  daily: Array<{ date: string; sent: number; failed: number }>;
}

export interface DailyActivity {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  replies: number;
  newLeads: number;
  meetings: number;
  scheduledSends: number;
}

export interface AnalyticsInsight {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  detail: string;
  /// Advice only — insights never mutate campaigns or mailboxes.
  recommendation: string | null;
}

export interface AnalyticsOverview {
  range: { from: string; to: string; period: AnalyticsPeriod; days: number };
  previousRange: { from: string; to: string };
  kpis: KpiCard[];
  counters: DeliveryCounters;
  rates: DeliveryRates;
  funnel: FunnelResult;
  timeline: TimelinePoint[];
  replies: ReplyAnalytics;
  meetings: MeetingAnalytics;
  topCampaigns: CampaignAnalyticsRow[];
  topMailboxes: MailboxAnalyticsRow[];
  insights: AnalyticsInsight[];
  /// Surfaced in the UI so nobody reads a missing metric as a zero.
  limitations: string[];
}

export const OPEN_TRACKING_NOTE = 'Open tracking unavailable.';
export const INSUFFICIENT_DATA_NOTE = 'Insufficient data';
