# Module 16 — Lead Discovery Engine (V1, Stage 1)

**Status:** Stage 1 implemented
**Scope:** Source adapters, file import, normalization, deduplication, source tracking, discovery jobs, ICP qualification, promotion to canonical leads, campaign enrollment, export

## Principle

Discovery **acquires** leads; every other module continues to own what happens to them afterwards. The engine adds no second sender, scheduler, queue, verifier, website analyzer, scoring engine or campaign enroller — it calls the existing ones.

Mandatory cost is **$0**. CSV/XLSX import, normalization, deduplication, source tracking, qualification, export and job tracking all run with no external provider. Paid sources are optional adapters.

## Architecture

- **Package:** `@signalforge/lead-discovery`
- **Queue:** `QUEUE_NAMES.LEAD_DISCOVERY` with `enqueueLeadDiscovery` (deterministic job ids)
- **Worker:** `workers/lead-discovery-worker` runs `runDiscoveryJob`
- **API:** `/lead-discovery`, workspace-guarded, `202` on job creation
- **Pipeline:** `DISCOVERED → NORMALIZED → DEDUPLICATED → EMAIL_CHECKED → QUALIFIED → READY → CAMPAIGN_ENROLLED`

## Data model

| Model | Purpose |
|-------|---------|
| `LeadDiscoveryJob` | One run, with per-stage counters and status |
| `DiscoveredLead` | Staging row; `email` is nullable, unique on `(jobId, source, sourceId)` |
| `LeadSourceRecord` | Every source a lead was seen in, unique on `(leadId, source, sourceId)` |
| `LeadDiscoveryActivity` | Audit trail, mirroring `CampaignActivity` |
| `LeadSourceConfig` | Per-workspace source enablement and usage counters |

`Lead` gained an index on `[workspaceId, companyDomain]` for domain-keyed dedup. No existing model was otherwise altered.

## Key decisions

**Staging is not a second lead database.** `Lead.email` is required and unique per workspace, but discovery sources routinely return a business with a name, phone and website and no email. `DiscoveredLead` is a pre-flight buffer; rows promote into `Lead` and record where they landed via `promotedLeadId`. A row with no email is reported as skipped rather than given a synthetic address.

**Deduplication is biased toward under-merging.** Six tiers run strongest-evidence-first: exact email → normalized domain → phone → source id → company+location → guarded fuzzy company name. Two records with *different known domains* are never merged by any name-based tier, because wrongly merging two real businesses silently destroys one; wrongly splitting one only costs a duplicate row.

**Promotion fills gaps, never overwrites.** Discovery data is weaker evidence than what a user or paid enrichment already stored, so an existing canonical field is left alone.

**Reuse over reimplementation.** Qualification calls the `@signalforge/ai` scorers against the existing `ICPProfile`; verification calls `verifyEmail`; enrollment calls `campaignLeadService.enrollLeads`, so suppression, unsubscribe, bounce and duplicate-enrollment policy are enforced by the campaign module and cannot be bypassed. File parsing reuses `@signalforge/integrations`.

**Inferred ≠ verified.** `EmailDiscoverySource` records whether an address came from the source, a `mailto:`, page text, enrichment, or was pattern-inferred. Inferred addresses are labelled "Guessed" in the UI and in exports.

## API

Prefix: `/lead-discovery`

- `GET/PUT /sources` — list and toggle sources (`PUT` requires `ADMIN`)
- `POST /import/preview` — headers, first rows and auto-detected column mappings
- `POST /jobs` → `202`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /jobs/:id/retry`
- `GET /jobs/:id/results` — filtered, sorted, paginated
- `GET /jobs/:id/export?format=csv|xlsx`
- `POST /jobs/:id/save` — promote to canonical leads
- `POST /jobs/:id/enroll` — promote then enroll into a campaign
- `GET /jobs/:id/activity`

## Frontend

- `/leads/discovery` — source picker, search form, file upload with column mapping, collapsible filters
- `/leads/discovery/[jobId]` — live counters via polling, results table, bulk select, save / add-to-campaign, CSV+XLSX export
- `/leads/discovery/history` — all runs

## Concurrency and cost

`createWorker` pins BullMQ concurrency at 5, so fan-out is bounded inside the job instead: `MAX_DISCOVERY_RESULTS` (default 500) and `MAX_EMAIL_VERIFY_CONCURRENCY` (default 5).

## Known v1 limitations

- Stage 2 not yet implemented: Google Places adapter, website-intelligence enrichment, public email discovery, AI research. The `DiscoveryStage` enum and `DiscoveredLead` columns for those already exist, so no migration is needed to add them.
- Yelp / Clutch / Yellow Pages are declared in the registry as "not configured". No scraping adapter ships for them; they need an authorized API.
- Scoring during discovery runs without website signals, so `hasWebsiteAnalysis` is false and `deriveAiOpportunity` returns `UNKNOWN` until Stage 2.
- `verifyEmail` is MX-only and never returns `RISKY`; it is not a deliverability guarantee.
- No AI usage/cost tracking exists anywhere in the platform, so external-cost display is estimate-only.
- Discovery has no scheduler tick; jobs are user-initiated.
