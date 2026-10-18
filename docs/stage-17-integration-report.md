# Stage 17: Full-System Integration & End-to-End Testing Report

## Executive Summary

Stage 17 delivers **110 new integration tests** across 13 test files, verifying that SignalForge's modules work together correctly through realistic, multi-step user journeys. All tests pass alongside the existing 282 unit tests (unmodified).

## Test Architecture

### Tier 1: API Integration Tests (no Docker required)

Uses `buildApp()` + `app.inject()` with a shared, interconnected mock database store that maintains referential integrity across tables.

**What's REAL:**
- All Fastify middleware, routing, and plugin registration
- Cookie-based session authentication with SHA-256 token hashing
- RBAC enforcement (4-tier: VIEWER, MEMBER, ADMIN, OWNER)
- Zod schema validation on all request bodies
- Business logic (normalization, dedup, qualification, eligibility)
- Error handling (ZodError -> 400, DB error -> 500, not-found -> 404, rate limit -> 429)
- Cross-module event publishing (workflow events, sending bootstrap)

**What's MOCKED:**
- Database persistence (shared Map-backed store with relational lookups)
- Redis/BullMQ (queue spy capturing enqueue calls)
- External APIs (SMTP, AI, scraper adapters)
- `publishWorkflowEvent` (verified via `vi.fn()` assertions)

### Tier 2: Schema Integrity Tests (requires Docker PostgreSQL)

Connects to a real `signalforge_test` database. Tests Prisma constraints, cascades, unique indexes, and foreign keys with actual PostgreSQL enforcement.

## Test Matrix

### Workflow Integration Tests (8 files, 72 tests)

| Workflow | File | Tests | Status |
|----------|------|-------|--------|
| A: Auth & Onboarding | `workflows/auth-onboarding.test.ts` | 9 | PASS |
| B: Lead Lifecycle | `workflows/lead-lifecycle.test.ts` | 14 | PASS |
| C: Lead Discovery Pipeline | `workflows/lead-discovery-pipeline.test.ts` | 10 | PASS |
| D: Campaign Enrollment | `workflows/campaign-enrollment.test.ts` | 11 | PASS |
| E: Website Intelligence | `workflows/website-intelligence.test.ts` | 6 | PASS |
| F: Workflow Automation | `workflows/workflow-automation.test.ts` | 11 | PASS |
| G: Sending Pipeline | `workflows/sending-pipeline.test.ts` | 6 | PASS |
| H: Cross-Module Flow | `workflows/cross-module-flow.test.ts` | 5 | PASS |

### Cross-Cutting Integration Tests (4 files, 27 tests)

| Concern | File | Tests | Status |
|---------|------|-------|--------|
| Workspace Isolation | `cross-cutting/workspace-isolation.test.ts` | 7 | PASS |
| RBAC Enforcement | `cross-cutting/rbac.test.ts` | 8 | PASS |
| Idempotency | `cross-cutting/idempotency.test.ts` | 5 | PASS |
| Error Handling | `cross-cutting/error-handling.test.ts` | 7 | PASS |

### Schema Integrity Tests (1 file, 11 tests)

| Test | Status |
|------|--------|
| Unique email constraint on User | PASS |
| Unique (workspaceId, userId) on WorkspaceMember | PASS |
| Session cascade delete on User delete | PASS |
| Lead FK to Workspace | PASS |
| Unique (workspaceId, type, value) on Suppression | PASS |
| Unique (leadId, tagId) on LeadTag | PASS |
| Unique (workspaceId, idempotencyKey) on WorkflowEvent | PASS |
| Unique (campaignId, leadId) on CampaignLead | PASS |
| Cascade Lead delete on Workspace delete | PASS |
| Cascade Campaign delete on Workspace delete | PASS |
| Suppression upsert updates reason on duplicate key | PASS |

## Test Execution Results

| Suite | Files | Tests | Duration | Command |
|-------|-------|-------|----------|---------|
| Unit Tests | 28 | 282 | ~40s | `pnpm --filter @signalforge/api test` |
| API Integration | 12 | 99 | ~30s | `pnpm --filter @signalforge/api test:integration` |
| Schema Integrity | 1 | 11 | ~3s | `DATABASE_URL=... pnpm --filter @signalforge/database test:integration` |
| **Total** | **41** | **392** | **~73s** | |

## Defects Found and Fixed

1. **Mock DB: Composite unique key matching** — The generic `matchesWhere()` function in `mock-db.ts` did not handle Prisma's composite unique keys (e.g., `workspaceId_type_value`). Fixed by expanding unrecognized nested object keys into individual field comparisons when the key doesn't exist as a field on the record.

2. **Schema validation mismatches** (found during Phase 2) — Multiple test payloads used incorrect field names: `subject`/`body` instead of `subjectTemplate`/`bodyTemplate`, `leadIds` instead of `discoveredLeadIds`, `GOOGLE_MAPS` instead of `GOOGLE_MAPS_SCRAPER`, missing `confirmed: true` for campaign stop. All fixed by reading actual Zod schemas.

3. **Service response shape mismatches** (found during Phase 2) — Campaign launch route checks `result.success` and returns 400 if falsy. Workflow validate uses `versions[0]` not `draftVersion`. Discovery source config uses `{ source, enabled }` not `{ sources: [] }`. All mock returns corrected.

4. **Suppression `reason` field** — The Prisma schema requires `reason` as a non-optional enum field (the API route provides a default via Zod, but direct Prisma calls need it). Fixed in schema integrity test.

## Infrastructure Created

### Shared Test Infrastructure (`apps/api/src/__integration__/`)

| File | Purpose |
|------|---------|
| `setup.ts` | Global mock setup for 18+ packages |
| `helpers/mock-db.ts` | ~800-line shared mock DB store with 25+ model types |
| `helpers/auth.ts` | `createTestUser()`, `addMember()`, `as()` helpers |
| `helpers/factories.ts` | 15 factory functions for all domain models |
| `helpers/queue-spy.ts` | Queue mock capturing enqueue calls |

### Configuration

| File | Purpose |
|------|---------|
| `apps/api/vitest.integration.config.ts` | Vitest config for API integration tests |
| `packages/database/vitest.integration.config.ts` | Vitest config for schema integrity tests |
| `apps/api/vitest.config.ts` | Updated to exclude `__integration__/` from unit runs |

### Scripts Added

- `apps/api/package.json`: `test:integration`
- `packages/database/package.json`: `test:integration`

## Blocked Scenarios

### Browser E2E Testing
No browser testing framework (Playwright/Cypress) is installed. All backend behavior is verified via `app.inject()`, but frontend rendering and client-side state remain untested. **Prerequisite for Stage 18+.**

### Real Redis/BullMQ Testing
Queue operations use a mock spy. Real Redis integration testing would require a running Redis instance and BullMQ worker lifecycle tests.

## Module Coverage Matrix

| Module | CRUD | Auth | RBAC | Isolation | Validation | Cross-Module |
|--------|------|------|------|-----------|------------|--------------|
| Auth | 9 tests | Direct | N/A | N/A | 2 tests | Session flow |
| Leads | 14 tests | Cookie | Guard | 2 tests | 2 tests | Tag, enroll |
| Campaigns | 11 tests | Cookie | Guard | 2 tests | 2 tests | Send, events |
| Discovery | 10 tests | Cookie | ADMIN | 1 test | 2 tests | Promote leads |
| Website Intel | 6 tests | Cookie | Guard | 1 test | N/A | Queue + lead |
| Automations | 11 tests | Cookie | ADMIN | N/A | 1 test | Workflow events |
| Sending | 6 tests | Cookie | Guard | N/A | N/A | Campaign bootstrap |
| Suppressions | 2 tests | Cookie | Guard | N/A | 2 tests | Upsert idempotency |

## Recommendation for Stage 18 Readiness

Stage 17 confirms that all critical backend workflows function correctly when modules interact. The test infrastructure supports future regression testing. To proceed to Stage 18:

1. **Install Playwright** for browser E2E tests covering frontend rendering
2. **Add Redis integration tests** for real queue processing
3. **CI pipeline integration** — add `test:integration` to the CI workflow
4. **Coverage threshold** — set minimum coverage targets for integration tests
