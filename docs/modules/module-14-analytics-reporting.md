# Module 14 — Analytics & Reporting

**Status:** Implemented
**Scope:** Workspace-scoped analytics hub, lead funnel, campaign/sequence/reply/dimensional reporting, daily rollups, CSV export, optional AI summaries

## Principle

Module 14 **analyzes** data produced by Modules 3–13. It does not reimplement sending, verification, reply handling, or deliverability math.

Email rates always come from `calculateRates()` in `@signalforge/deliverability`. Warmup traffic is read from `WarmupDailyHistory` and is never mixed into campaign KPIs. Meetings are counted only from `LeadOutcomeEvent` — a positive reply is never treated as a booked meeting.

```
EXISTING SIGNALS → QUERY / ROLLUP → FUNNEL & KPIs → INSIGHTS → EXPORT / AI SUMMARY
```

## What Was Added

### Data model

| Model | Purpose |
|-------|---------|
| `LeadOutcomeEvent` | Real business outcomes (`MEETING_BOOKED`, `QUALIFIED`, `CONVERTED`) logged manually or via API |
| `WorkspaceAnalyticsSnapshot` | Daily UTC rollup of funnel, email, verification, reply, and warmup counters |

Supporting indexes: `CampaignLead(campaignId, repliedAt)`, `Conversation(workspaceId, firstReplyAt)`, `EmailMessage(workspaceId, sentAt)`, plus lead industry/job-title/status composites.

### Behavioural fix

After a successful send, the email worker sets `Lead.status` from `NEW` to `CONTACTED` in the same transaction. The update is scoped to `NEW` so a later step cannot downgrade a lead that has already replied or been qualified.

### `packages/analytics`

| Module | Responsibility |
|--------|----------------|
| `metrics/range.ts` | Presets (`today`, `yesterday`, `7d`, `30d`, `90d`) and custom ranges, capped at 366 days |
| `metrics/formulas.ts` | Lead/funnel rates with sample-size guards; email rates imported from deliverability |
| `metrics/counters.ts` | Workspace-scoped funnel and activity queries |
| `funnel-service.ts` | Stage counts, conversion vs previous/top, drop-off |
| `stats-service.ts` | Overview, campaigns, sequences, subjects, mailboxes, dimensions, replies, warmup, imports |
| `aggregation-service.ts` | Idempotent daily upsert into `WorkspaceAnalyticsSnapshot` |
| `insights-service.ts` | Rule-based observations, silent below minimum sample size |
| `export-service.ts` | CSV of aggregate metrics only |
| `outcome-service.ts` | Record / list / delete outcomes, always workspace-scoped |
| `scheduler.ts` | Enqueue today + yesterday rollups with deterministic job IDs |

### Worker & queue

- `QUEUE_NAMES.ANALYTICS` payload `{ workspaceId, snapshotDate }`
- `workers/analytics-worker` runs the daily upsert
- Scheduler tick re-queues today and yesterday for active workspaces; job IDs collapse duplicates

### API (`/analytics`)

Overview, timeline, funnel, campaigns, sequences, subjects, mailboxes, SMTP pools, leads, sources, industries, geography, job titles, company sizes, website intelligence, imports, warmup, daily activity, top performers, insights, CSV export, outcomes CRUD, and `POST /analyze`. All routes take workspace id from the session. Outcome writes require `ADMIN`.

### Frontend (`/analytics`)

Hub with KPI cards, email chart, funnel, top campaigns/mailboxes, and insights. Nested views for campaigns, sequences, replies, leads, audience (sources/industry/geo/job title/company size), mailboxes, warmup, imports, website intelligence, and outcomes. Dashboard shows a 7-day summary strip. Deliverability stays on `/deliverability`.

### AI boundary

`analyzeAnalytics` receives pre-computed KPIs only and returns narrative highlights, concerns, and recommendations. `advisoryOnly: true`. It is never asked to invent open rates, revenue, or ROI, and nothing it returns is stored or used to change sending behaviour.

## Funnel stage mapping

| Stage | Definition |
|-------|------------|
| Imported | Leads created in the range |
| Verified | `LeadVerification.status = VERIFIED` |
| Qualified | `Lead.status = QUALIFIED` or enrichment HIGH/VERY_HIGH |
| Contacted | Status `CONTACTED` or later, or a successful send |
| Replied | Inbound reply matched to a conversation |
| Positive reply | Classification `POSITIVE` or `INTERESTED` |
| Meeting | `LeadOutcomeEvent.type = MEETING_BOOKED` |

Rates below 10 leads or 20 sends render as **Insufficient data**, not `0%`. Open tracking is shown as **Open tracking unavailable.**

## Verification

- Migration `20260902120000_module_14_analytics` applied; `prisma migrate diff` reports no difference.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass (50/50 lint-typecheck-test tasks, 31/31 build).
- 59 unit tests in `packages/analytics` cover formulas, funnel drop-off, range resolution, sample-size guards, export, and workspace isolation of funnel queries.
- API isolation tests cover outcome record/list/delete across workspaces.
- Email-worker regression: first successful send marks the lead `CONTACTED`; failed/deferred sends do not.

## Known limitations

- **Meetings** require a manual or API `LeadOutcomeEvent` until a calendar integration exists.
- **CSV import** has no `LeadImport` history — import analytics cover Drive/batch imports only.
- **Open rate** is unavailable and is labelled as such; it is never shown as zero.
- **Revenue / ROI** are not tracked and are not displayed.
- **Company size** cohorts depend on enrichment JSON completeness; missing values group as Unknown.
- **Lead source** uses the stored enum (`MANUAL`, `CSV_IMPORT`, `GOOGLE_DRIVE`, `DISCOVERY`, `API`, `OTHER`), not external provider names.
