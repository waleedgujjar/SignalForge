# Module 17 — Lead Research (LinkedIn first)

**Status:** Implemented, behind `LINKEDIN_RESEARCH_ENABLED` (default `false`)
**Scope:** Source-agnostic `LeadResearch` records, LinkedIn URL research (public single fetch / Agent-Reach health / manual), researcher verification, provenance, unified research history, AI qualification and scoring evidence, provider settings

Full guide: [`docs/linkedin-research.md`](../linkedin-research.md).

## Principle

Research **enriches** leads that already exist; it acquires nothing and automates nothing on LinkedIn. The module adds no second scoring engine, qualification, queue system, AI provider or audit table — it feeds evidence into the existing enrichment worker, AI Provider Layer, scorers and campaigns.

Only researcher-provided URLs are ever looked at, at most once per researcher action. A provider refusal (authwall, 429/999, private profile) stops the job and routes the record to **Manual Review** with the reason. No LinkedIn credential, cookie or session is stored in SignalForge.

## Architecture

- **Package:** `@signalforge/lead-research` — source-agnostic service + `linkedin/` provider layer (`manual`, `public`, `agent-reach`, planned `authorized-api`) behind one `LinkedInResearchProvider` interface; chain selection always terminates in `manual`
- **Queue:** `QUEUE_NAMES.LEAD_RESEARCH` with `enqueueLeadResearch` (deterministic job ids, 2 attempts, retry only for timeouts / unavailable providers)
- **Worker:** `workers/lead-research-worker` (`LINKEDIN_RESEARCH_MAX_CONCURRENCY`, default 1); re-enqueues enrichment after a result
- **API:** `/lead-research`, workspace-guarded, `202` on job creation, `501` mutations when the flag is off
- **AI/scoring:** `LeadEnrichmentInput.linkedInResearch` → `enrichLead` → `LeadEnrichment.opportunityAssessment` (each fact `VERIFIED | INFERRED | UNKNOWN`); researched employee range feeds `calculateICPFitScore.companySize`, researched title feeds seniority when the lead has none

## Data model

| Model | Purpose |
|-------|---------|
| `LeadResearch` | One attempt against one source for one lead; append-only history; `PENDING` = suggestion awaiting approval |
| `LeadResearchActivity` | Audit trail, mirroring `LeadDiscoveryActivity` |
| `ResearchProviderConfig` | Per-workspace enablement, usage counters, last health result — no credentials |

`LeadEnrichment` gained `opportunityAssessment Json?`; `WorkflowEventType` gained `LEAD_RESEARCH_COMPLETED`. `Lead` was not altered.

## Key decisions

**Verification is orthogonal to lifecycle.** `status` is the lifecycle; per-field provenance carries `VERIFIED | INFERRED | UNKNOWN` and a numeric confidence. Manual entry is `VERIFIED`; provider-fetched public data is `INFERRED` and capped at `MEDIUM` until a human marks it verified.

**Manual is the terminal provider.** The chain is `[selected provider if configured & enabled] → manual`, so research never fails silently.

**Never route around a refusal.** The chain continues only when a provider could not run at all (`PROVIDER_NOT_CONFIGURED` / `PROVIDER_UNAVAILABLE`); `LOGIN_REQUIRED`, `RATE_LIMITED`, `PRIVATE_PROFILE`, `PAGE_UNAVAILABLE` end it.

**Absence of evidence is `UNKNOWN`.** The AI prompt and the mock provider both refuse to turn "not researched" into "false".

**No LinkedIn columns on `Lead`.** URLs live on `LeadResearch.sourceUrl`; the existing `Lead.linkedinUrl` is filled only when empty (fill-gaps, never overwrite).

**History is composed, not duplicated.** `GET /lead/:leadId/history` merges `LeadResearch`, `WebsiteAnalysis` and `EmailVerificationHistory` at read time.

## Frontend

- `/leads/[id]` — Research card (LinkedIn / Website / Web / Facebook tabs), Research History card, Opportunity Assessment inside Lead Intelligence
- `/leads/research` — Research Queue (suggested, manual review, failed; bulk approve)
- `/settings/research` — Research Providers (status, authentication label, health check, toggles, setup instructions, compliance notice)

## Known limitations

- The authenticated Agent-Reach `linkedin-mcp-server` path is a gated, unimplemented extension point (read tools only, if ever).
- Facebook / YouTube / Reddit / Web sources exist as enum values only.
- Research does not yet run inside the discovery pipeline (`DiscoveredLead.aiResearch` is still reserved for that).
- Agent-Reach's Windows support is not verified upstream; unparseable `doctor` output is reported as `UNAVAILABLE`.
