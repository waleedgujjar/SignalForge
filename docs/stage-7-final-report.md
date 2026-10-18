# Stage 7 Final Report: Lead Finder Backend & API Integration

**Date:** 2026-10-08
**Status:** COMPLETE

---

## Summary

Stage 7 exposed the Lead Discovery system through a clean, production-ready backend API for Stage 8's Lead Finder UI. After thorough inspection, the API already substantially existed — 14 endpoints under `/lead-discovery/` with full validation, auth, pagination, filtering, sorting, queue integration, and the complete discovery pipeline. The primary deliverable became a comprehensive 59-test API test suite plus minor gap-filling.

---

## Files Changed

| Action | File | What Changed |
|--------|------|--------------|
| MODIFIED | `packages/validation/src/index.ts` | Added `verificationStatusEnum`, `emailStatus` filter, and `state` filter to `discoveryResultsQuerySchema` |
| MODIFIED | `apps/api/src/routes/lead-discovery.ts` | Added ZodError handling to `handleDiscoveryError()`, wired `emailStatus`/`state` filters into `buildResultsWhere()`, wrapped 3 GET routes in try/catch for consistent error handling |
| MODIFIED | `apps/web/src/lib/api.ts` | Added `fetchDiscoveryActivity()` and `requalifyDiscoveryJob()` frontend API helpers |
| CREATED | `apps/api/src/routes/lead-discovery.test.ts` | 59 comprehensive API tests covering all 14 endpoints |

## Files NOT Modified

- `packages/lead-discovery/` — Pipeline, qualification, normalization, dedup, promotion unchanged
- `packages/database/prisma/schema.prisma` — No new fields, no migration needed
- `packages/queue/` — No new queue types or payloads
- `workers/lead-discovery-worker/` — No worker changes
- `packages/ai/` — No scoring changes
- `packages/config/` — No new config
- `.env.example` — No new env vars

---

## API Endpoints (All Pre-Existing, Now Fully Tested)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/lead-discovery/sources` | List available discovery sources |
| POST | `/lead-discovery/jobs` | Create a discovery job |
| GET | `/lead-discovery/jobs` | List jobs (paginated, filterable) |
| GET | `/lead-discovery/jobs/:id` | Get job status and details |
| GET | `/lead-discovery/jobs/:id/results` | Get paginated, filtered, sorted results |
| GET | `/lead-discovery/jobs/:id/export` | Export results as CSV |
| GET | `/lead-discovery/jobs/:id/activity` | Get activity log |
| POST | `/lead-discovery/jobs/:id/cancel` | Cancel a pending/running job |
| POST | `/lead-discovery/jobs/:id/retry` | Retry a failed/completed job |
| POST | `/lead-discovery/jobs/:id/requalify` | Re-run qualification (admin only) |
| POST | `/lead-discovery/jobs/:id/save` | Promote discovered leads to CRM |
| POST | `/lead-discovery/jobs/:id/enroll` | Enroll leads into campaigns |
| POST | `/lead-discovery/import/preview` | Preview CSV import |
| POST | `/lead-discovery/import` | Import leads from CSV |

---

## Database Changes

**None.** All required models (`LeadDiscoveryJob`, `DiscoveredLead`, `ICPProfile`), enums (`VerificationStatus`, `LeadDiscoveryActivityType`), and indexes were already in place. The `REQUALIFIED` activity type and `qualificationSignals`/`qualificationVersion` columns from Stage 6 migration are sufficient.

---

## Architecture

```
Browser → Next.js proxy → Fastify API (/lead-discovery/*)
  → Prisma: create/read LeadDiscoveryJob
  → BullMQ: enqueue 'discovery-run' (concurrency: 5)
  → 202 { jobId, status }

Worker picks up job:
  → runDiscoveryJob()
    → GoogleMapsScraperAdapter.search()
      → NominatimGeocoder (location → lat/lon)
      → ScraperClient (create job, poll, download CSV)
    → normalizeLead()
    → loadDedupCandidates() + createDedupIndex()
    → discoverEmailForLeads() (if enabled)
    → verifyEmailFull() (concurrency: 5)
    → qualifyLead() (ICP fit + quality + prospect score)
    → Prisma upsert DiscoveredLead ([jobId, source, sourceId])
  → Update job counters + status
  → logDiscoveryActivity()

Browser polls: GET /lead-discovery/jobs/:id
Browser fetches: GET /lead-discovery/jobs/:id/results
```

---

## Security

- **Workspace isolation**: Every endpoint validates `workspaceId` via `getWorkspaceId(request)`. Cross-workspace access returns 404 (not 403, preventing existence leaks).
- **Authentication**: Cookie-based session auth (`sf_session`) required on all endpoints. Unauthenticated requests return 401.
- **Authorization**: `requalify` endpoint requires ADMIN role via `requireWorkspaceRole('ADMIN')`.
- **Input validation**: All inputs validated via Zod schemas with max lengths, enum allowlists, positive number checks. Invalid sort values, negative pages, oversized limits all return 400.
- **No scraper exposure**: The scraper is never exposed to the browser. Jobs are enqueued to BullMQ and processed by the worker.
- **Idempotency**: Unique constraint `[jobId, source, sourceId]` prevents duplicate leads.

---

## Testing

**59 tests across 10 categories, all passing:**

| Category | Tests | Coverage |
|----------|-------|----------|
| Authentication | 1 | Rejects unauthenticated requests across all endpoints |
| Sources | 1 | Returns available discovery sources |
| Job Creation | 5 | Valid creation, missing source, missing query, excessive maxResults, enqueue verification |
| Job Status | 3 | Own job, unknown ID → 404, cross-workspace → 404 |
| Job History | 4 | Paginated list, status filter, source filter, workspace isolation |
| Results | 13 | Pagination shape, 10 filters (qualified, hasEmail, emailStatus, minScore, search, state, etc.), sorting, empty results, cross-workspace |
| Cancellation | 5 | Cancel pending/running, reject completed/cancelled/failed, cross-workspace |
| Retry | 4 | Retry failed/completed, reject running, cross-workspace |
| Activity & Save/Requalify | 8 | Activity log, save/promote, requalify (admin only, member rejected, cross-workspace) |
| Security & Input Validation | 15 | Cross-workspace isolation on all operations, invalid sort → 400, negative page → 400, huge limit → 400, XSS in search → safe, long string → safe |

**Test infrastructure:**
- Multi-tenant session mocks (ws1 admin, ws1 member, ws2 admin)
- In-memory Maps for jobs and leads with `makeJob()` and `makeLead()` helpers
- Mocked Prisma, BullMQ queue, and lead-discovery service modules
- Follows established pattern from `lead-research.test.ts`

---

## Bug Fixes (Found During Testing)

1. **Zod validation errors on GET routes returned 500 instead of 400**: Three GET routes (`/jobs`, `/jobs/:id/results`, `/jobs/:id/export`) lacked try/catch blocks. Invalid query parameters (negative page, invalid sort) threw ZodError but were not caught, resulting in 500. Fixed by wrapping in try/catch with `handleDiscoveryError()`.

2. **ZodError not formatted in error handler**: `handleDiscoveryError()` did not handle `ZodError` specifically, so even when caught, validation errors returned a generic 500. Added ZodError case to return 400 with field-level issues.

---

## Scope Confirmation

### Built (Stage 7)
- Comprehensive API test suite (59 tests)
- Missing result filters (`emailStatus`, `state`)
- ZodError handling in error handler
- Try/catch on GET routes for consistent error responses
- Frontend API helpers for activity and requalify endpoints

### NOT Built (Correctly Deferred)
- Lead Finder frontend UI (Stage 8)
- AI enrichment / Website Intelligence (Stage 10)
- Google Places API / Google Maps API key (uses existing Google Maps Scraper Kit)
- New auth, queue, or validation systems (uses existing)
- New database migrations (existing schema sufficient)
- No AI/LLM calls (all deterministic)

---

## Pre-Existing Issues (Not Caused by Stage 7)

1. **`@signalforge/web` build failure**: ESLint `no-unused-vars` errors in `leads/page.tsx` for `VERIFICATION_BADGE_VARIANT`, `VERIFICATION_LABEL`, `verifyMutation`, `verStatus`. These are variables from a prior stage that were declared but never wired up. Unrelated to Stage 7 changes.

2. **`lead-research.test.ts` failures**: 2 pre-existing test failures due to missing `getEnv` export in config mock. Unrelated to Stage 7.

---

**HARD STOP — Stage 7 Complete.**
