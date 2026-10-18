# Module 13 — Deliverability & Email Health

**Status:** Implemented
**Scope:** Delivery measurement, bounce management, mailbox/campaign health scoring, authentication checks, automatic protection, alerts, recommendations

## Principle

The module follows one path end to end:

```
SEND → MEASURE → ANALYZE → DETECT RISK → PROTECT MAILBOX → RECOMMEND ACTION
```

Every number the product shows is derived from a signal SignalForge actually observed: an SMTP response, a DNS lookup, or an inbox event. Nothing is inferred, estimated, or predicted. The module contains no technique for bypassing spam filters or evading provider enforcement — it exists to keep sending behavior measurable and to stop unsafe sending early.

## What Was Added

### Data model

New Prisma models, all workspace-scoped:

| Model | Purpose |
|-------|---------|
| `EmailDeliveryEvent` | Append-only measurement log for SENT, DELIVERED, BOUNCED, FAILED, REPLY, UNSUBSCRIBE, COMPLAINT |
| `RecipientBounceState` | Per-recipient bounce history and escalation status |
| `MailboxHealthSnapshot` | Daily rollup per mailbox |
| `CampaignHealthSnapshot` | Daily rollup per campaign |
| `DomainHealthCheck` | Cached SPF/DKIM/DMARC/MX results |
| `DeliverabilityAlert` | Deduplicated alerts with severity and status |
| `WorkspaceDeliverabilityPolicy` | Per-workspace thresholds, weights, and protection toggles |

`EmailMessage` gained `deliveredAt`, `bounceType`, `smtpStatusCode`, `enhancedStatusCode`, and `providerResponse`. `MailboxHealth` gained `hardBounceCount`, `softBounceCount`, `protectionLevel`, `protectionReason`, `protectionUpdatedAt`, and `scoreBreakdown`.

The existing `Suppression` model is reused for enforcement; `RecipientBounceState` records history and never replaces it.

### `packages/deliverability`

| Module | Responsibility |
|--------|----------------|
| `bounce-classifier` | Normalizes SMTP responses into HARD / SOFT / not-a-bounce |
| `delivery-event-service` | Idempotent event recording |
| `recipient-bounce-service` | Soft-bounce escalation to AT_RISK and SUPPRESSED |
| `health-score-service` | Transparent weighted 0–100 score with component breakdown |
| `dns-checker` | Timeout-bounded SPF/DKIM/DMARC/MX lookups |
| `domain-health-service` | Cached checks with a re-check cooldown |
| `velocity-service` | Volume tracking against a trailing baseline |
| `protection-service` | Protection level, mailbox pausing, and manual resume |
| `alert-service` | Alert raising with daily-window deduplication |
| `recommendation-service` | Rule-based next actions |
| `aggregation-service` | Daily snapshot rollups |
| `stats-service` | Dashboard queries, trends, and comparison tables |
| `export-service` | CSV export of aggregate metrics only |
| `send-gate` | Real-time block decisions shared by the API, scheduler, and worker |

## Key Decisions

**Attempts as the denominator.** Every rate divides by attempted sends — accepted sends plus bounces plus failures. Using accepted sends instead would make a mailbox look healthier the more often it failed.

**Conservative bounce classification.** A rejection is only HARD when it is unambiguously permanent: a 5.x.x enhanced status, a 5yz reply code, or an explicit invalid-recipient phrase. Everything temporary or ambiguous stays SOFT, so a transient provider outage never permanently suppresses a real address. Authentication and connection errors are classified as neither — they are our problem, not the recipient's.

**Unknown is not failure.** A DNS timeout resolves to UNKNOWN rather than FAIL, and UNKNOWN checks are excluded from the score rather than penalized. DKIM stays UNKNOWN until the workspace supplies a selector, because DKIM cannot be queried without one.

**Absence of data is never a problem.** A mailbox with no sending activity scores 100 with every component neutral. Rate-based rules do not apply until the mailbox has passed the configured minimum volume, so a handful of sends cannot flag a mailbox.

**Complaint rate is null, never estimated.** Without a provider feedback loop there is no complaint data, and the UI says so explicitly instead of showing a zero that looks like good news.

**Protection is deterministic.** Thresholds drive the protection level, and only an explicit policy toggle can pause a mailbox. Suppression on hard bounce and unsubscribe is always enforced and cannot be turned off. Every pause and resume writes a `MailboxActivity` record, so the change is never silent.

**Idempotent measurement.** Every delivery event carries a key derived from the job and attempt number, so a retried worker job records one event rather than inflating the metrics.

## Integration Points

- **Module 9 (sending):** `evaluateSendingEligibility` accepts a deliverability verdict, evaluated after the campaign and lead rules so the most specific reason still wins. The scheduler defers recoverable blocks rather than cancelling the job.
- **Module 9 (email worker):** The pipeline records SENT, BOUNCED, and FAILED events, classifies bounces, updates recipient state, re-checks the mailbox gate after allocation, and recomputes health after a failure.
- **Module 12 (inbox):** Reply and unsubscribe actions emit the matching delivery events, so reply rate and unsubscribe rate come from real inbox activity.
- **Scheduler worker:** A new tick queues daily aggregation and expired domain re-checks, processed by `workers/deliverability-worker`.

## AI Boundary

`analyzeDeliverability` takes a metrics-only payload — counters, rates, authentication status, and health score — and returns a narrative summary with investigation areas and suggestions. It is advisory only. It cannot suppress a recipient, pause a mailbox, change a threshold, or affect send eligibility, and every response carries that disclaimer.

## Verification

- Migration `20260901120000_module_13_deliverability` applied; `prisma migrate diff` reports no difference between the schema and the database.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass across all workspace tasks.
- 103 unit tests in `packages/deliverability` cover bounce classification, rate formulas, health scoring, DNS evaluation, alert deduplication, protection escalation, recipient escalation, CSV export, recommendations, event idempotency, and workspace isolation of every counter query.
- Regression coverage for Modules 8–12 passes unchanged, with new email-worker pipeline tests for the deliverability paths.
