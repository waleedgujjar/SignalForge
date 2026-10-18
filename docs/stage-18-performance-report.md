# Stage 18: Load & Performance Testing Report

## Executive Summary

Stage 18 delivers SignalForge's first **load testing infrastructure** using Grafana k6, identifies **6 performance bottleneck areas** through code analysis and EXPLAIN ANALYZE query design, applies **7 targeted fixes** (connection pool tuning, missing indexes, bounded queries, configurable rate limits, bundle analyzer), and provides a complete measurement framework ready to produce before/after comparisons. All 392 existing tests (282 unit + 99 integration + 11 schema) pass after changes.

## What Was Built

### k6 Load Test Infrastructure (6 scenarios)

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| Smoke | 1 | 10 iters | Sanity check |
| API Baseline | 5 | 60s | Per-endpoint p50/p95/p99 |
| Stress | 1→50 | 4 min | Breaking points |
| Soak | 10 | 10 min | Memory leaks, pool exhaustion |
| Pool Stress | 5→20 | 2 min | Prove pool starvation |
| Search Stress | 10 | 60s | ILIKE performance by term length |

### Queue & Worker Test Scripts (3 scripts)

- **queue-throughput.ts** — Measures jobs/second for campaign-enrollment, email-send, email-verification workers
- **queue-backpressure.ts** — Sustained 1000-job injection with depth monitoring
- **inject-queue-jobs.ts** — Bulk BullMQ job injector with timing metrics

### Database Analysis Tools

- **explain-queries.sql** — 6 EXPLAIN ANALYZE queries for heaviest patterns
- **monitor-pg-pool.sql** — pg_stat_activity connection pool monitoring

### Frontend Performance Tools

- **@next/bundle-analyzer** — Optional dev dependency, activated via `ANALYZE=true`
- Lighthouse audit command documented in report

## Bottlenecks Identified

| # | Issue | Severity | Fix Applied |
|---|-------|----------|-------------|
| 1 | PG pool default 10, analytics fires 10+ parallel queries | High | Configurable `PG_POOL_MAX`, default 25 |
| 2 | Missing `EmailMessage.leadId` index | High | Composite index on `(leadId, sentAt)` |
| 3 | Missing `CampaignLead.leadId` index | High | Index on `leadId` |
| 4 | Campaign detail loads ALL enrollments unbounded | Medium | Capped at 100 + new paginated endpoint |
| 5 | `computeDailyBuckets` unbounded fetch | Medium | Added `take: 50,000` safety bound |
| 6 | `getCompanySizeRows` fetches 20k rows | Low | Reduced to 5k |
| 7 | Lead export fetches 10k rows | Low | Reduced to 5k |

## Files Created (19)

All under `load-tests/`:
- `config.js`, `helpers/auth.js`, `helpers/data-generators.js`
- `scripts/setup-test-db.sh`, `scripts/seed-perf-data.ts`, `scripts/explain-queries.sql`, `scripts/monitor-pg-pool.sql`, `scripts/inject-queue-jobs.ts`
- `scenarios/smoke.js`, `scenarios/api-baseline.js`, `scenarios/stress.js`, `scenarios/soak.js`, `scenarios/pool-stress.js`, `scenarios/search-stress.js`, `scenarios/queue-throughput.ts`, `scenarios/queue-backpressure.ts`
- `.env.perf`, `REPORT.md`

## Files Modified (10)

| File | Change |
|------|--------|
| `packages/database/src/index.ts` | Configurable pool max via `PG_POOL_MAX` |
| `packages/config/src/index.ts` | Added `PG_POOL_MAX`, `RATE_LIMIT_MAX` env vars |
| `packages/database/prisma/schema.prisma` | 2 new indexes |
| `packages/database/prisma/migrations/20261009130000_add_perf_indexes/migration.sql` | Index migration |
| `apps/api/src/app.ts` | Configurable rate limit |
| `apps/api/src/routes/campaigns.ts` | Bounded detail + paginated leads endpoint |
| `apps/api/src/routes/leads.ts` | Reduced export limit |
| `packages/analytics/src/stats-service.ts` | Safety bounds on analytics queries |
| `apps/web/next.config.ts` | Optional bundle analyzer |
| `apps/web/package.json` | Added `@next/bundle-analyzer` devDependency |

## Defects Fixed (2 pre-existing)

1. `MockTag` missing `updatedAt` field in integration test helpers
2. Invalid `WorkflowEventType` enum value `'LEAD_UPDATED'` in schema integrity test

## Test Verification

```
Unit Tests:        282 PASS
Integration Tests:  99 PASS
Schema Tests:       11 PASS (requires Docker)
Typechecks:         4/4 packages PASS (config, database, api, analytics)
```

## Known Limitations

- **ILIKE search** cannot use B-tree indexes; needs `pg_trgm` GIN indexes (future stage)
- **Lead import** loads entire file into memory; needs streaming (future stage)
- **No APM/metrics** infrastructure; OpenTelemetry recommended for future stage

## How to Run

```bash
# 1. Setup perf database
cd load-tests && bash scripts/setup-test-db.sh

# 2. Start API with perf config
cp load-tests/.env.perf apps/api/.env
pnpm --filter @signalforge/api dev

# 3. Run k6 scenarios (install k6 first: winget install Grafana.k6)
k6 run load-tests/scenarios/smoke.js
k6 run load-tests/scenarios/api-baseline.js
k6 run load-tests/scenarios/stress.js

# 4. Run queue tests
npx tsx load-tests/scenarios/queue-throughput.ts
npx tsx load-tests/scenarios/queue-backpressure.ts

# 5. Frontend bundle analysis
ANALYZE=true pnpm --filter @signalforge/web build
```

Full details: [`load-tests/REPORT.md`](../load-tests/REPORT.md)
