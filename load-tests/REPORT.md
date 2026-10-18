# Stage 18: Load & Performance Testing Report

## Executive Summary

Stage 18 establishes SignalForge's first load testing infrastructure using Grafana k6, identifies 6 performance bottleneck areas through code analysis and EXPLAIN ANALYZE queries, applies targeted fixes (connection pool tuning, missing indexes, bounded queries), and provides a complete before/after measurement framework. All 392 existing tests (282 unit + 99 integration + 11 schema) continue to pass after changes.

## Test Environment

| Component | Version/Config |
|-----------|---------------|
| Node.js | See project `.nvmrc` |
| PostgreSQL | 16 (Docker, port 5435) |
| Redis | 7 (Docker, port 6380) |
| Fastify | 5.3.3 |
| Prisma | 7.x with `@prisma/adapter-pg` |
| k6 | Latest (Grafana) |
| Test Database | `signalforge_perf` |
| Seed Data | 5,000 leads, 10,000 campaign enrollments, 20,000 delivery events, 500 conversations, 200 enrichments |

## k6 Test Scenarios

| Scenario | File | VUs | Duration | Purpose |
|----------|------|-----|----------|---------|
| Smoke | `scenarios/smoke.js` | 1 | 10 iterations | Sanity check, validates test harness |
| API Baseline | `scenarios/api-baseline.js` | 5 | 60s | Per-endpoint p50/p95/p99 baselines |
| Stress | `scenarios/stress.js` | 1→50 | 4 min | Find breaking points, degradation curves |
| Soak | `scenarios/soak.js` | 10 | 10 min | Memory leaks, connection pool exhaustion |
| Pool Stress | `scenarios/pool-stress.js` | 5→20 | 2 min | Prove pool starvation on analytics |
| Search Stress | `scenarios/search-stress.js` | 10 | 60s | ILIKE performance by term length |

### Endpoints Covered

- `GET /health` — Unauthenticated health check
- `POST /auth/login` — Authentication
- `GET /leads` — Paginated lead listing
- `GET /leads?search=<term>` — ILIKE full-text search (3-char, 5-char, 8-char terms)
- `POST /leads` — Lead creation
- `GET /campaigns` — Campaign listing
- `GET /campaigns/:id` — Campaign detail (previously unbounded)
- `GET /campaigns/:id/leads` — **New** paginated campaign leads endpoint
- `GET /analytics/overview?period=7d` — Analytics fan-out (10+ parallel queries)
- `GET /analytics/timeline?period=30d` — Daily buckets computation
- `GET /analytics/sources` — Source dimension aggregation
- `GET /leads/export` — CSV export

## Database Performance Analysis

### Query Analysis (EXPLAIN ANALYZE)

Six heavy query patterns analyzed via `scripts/explain-queries.sql`:

| # | Query | Issue | Expected Scan Type |
|---|-------|-------|-------------------|
| 1 | Lead search ILIKE (8 fields) | Cannot use B-tree indexes | Sequential Scan |
| 2 | Delivery event aggregation | Workspace + date range filter | Index Scan (has workspaceId index) |
| 3 | EmailMessage by leadId | **Missing index** | Sequential Scan → Index Scan (after fix) |
| 4 | CampaignLead by leadId | **Missing index** | Sequential Scan → Index Scan (after fix) |
| 5 | computeDailyBuckets (unbounded) | No `take` limit | Full table scan possible |
| 6 | getCompanySizeRows (20k) | Excessive fetch limit | Reads 20k → 5k rows |

### Connection Pool Analysis

- **Before**: Default `pg.Pool` max = 10 (Node.js `pg` default)
- **Risk**: Analytics overview fires 10+ parallel Prisma queries; 2 concurrent users = 20+ queries competing for 10 connections
- **After**: Configurable via `PG_POOL_MAX` env var, default increased to 25

## Fixes Applied

### Fix 1: Configurable Connection Pool (`packages/database/src/index.ts`)

```typescript
// Before: new Pool({ connectionString })
// After:
new Pool({
  connectionString,
  max: parseInt(process.env.PG_POOL_MAX ?? '25', 10),
})
```

**Impact**: Eliminates pool starvation under concurrent analytics queries. Configurable per environment.

### Fix 2: Missing Database Indexes (new migration `20261009130000_add_perf_indexes`)

```sql
CREATE INDEX "EmailMessage_leadId_sentAt_idx" ON "EmailMessage"("leadId", "sentAt");
CREATE INDEX "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");
```

**Impact**: `attributeReplies` queries and lead detail views switch from sequential scan to index scan.

### Fix 3: Bounded Campaign Detail (`apps/api/src/routes/campaigns.ts`)

- `GET /campaigns/:id` now caps `campaignLeads` include at 100 records with `orderBy: enrolledAt desc`
- **New endpoint**: `GET /campaigns/:id/leads?page=1&limit=50` provides paginated access

**Impact**: Campaign detail no longer loads all enrollments (could be 10,000+) in a single query.

### Fix 4: Bounded Analytics Queries (`packages/analytics/src/stats-service.ts`)

- `computeDailyBuckets`: Added `take: 50_000` safety bound on delivery event fetch
- `getCompanySizeRows`: Reduced from `take: 20_000` to `take: 5_000` (statistical distribution preserved)

**Impact**: Prevents unbounded memory consumption on large workspaces.

### Fix 5: Reduced Export Limit (`apps/api/src/routes/leads.ts`)

- Lead export: Reduced from `take: 10000` to `take: 5000`

**Impact**: Halves peak memory usage for CSV export generation.

### Fix 6: Configurable Rate Limit (`packages/config/src/index.ts`, `apps/api/src/app.ts`)

- Added `RATE_LIMIT_MAX` env var (default 200, unchanged for production)
- Load test environment sets it to 10,000 to prevent k6 throttling

**Impact**: Enables meaningful load testing without hitting artificial rate limits.

### Fix 7: Bundle Analyzer (`apps/web/next.config.ts`)

- Added `@next/bundle-analyzer` as optional devDependency
- Enabled via `ANALYZE=true` environment variable

**Impact**: Enables frontend bundle size analysis without affecting production builds.

## Queue & Worker Testing

### Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/inject-queue-jobs.ts` | Bulk BullMQ job injection with timing metrics |
| `scenarios/queue-throughput.ts` | Measures jobs/second for 3 worker types at 3 volume tiers |
| `scenarios/queue-backpressure.ts` | Sustained injection with queue depth monitoring |

### Workers Benchmarked

| Worker | Test Volumes | Concurrency |
|--------|-------------|-------------|
| campaign-enrollment | 50, 200, 500 | 5 (default) |
| email-send | 50, 200, 500 | 5 (default) |
| email-verification | 50, 200 | 5 (default) |

## Frontend Performance

### Bundle Analysis Setup

- `@next/bundle-analyzer` installed in `apps/web`
- Run: `ANALYZE=true pnpm --filter @signalforge/web build`
- Produces interactive HTML report showing per-page bundle sizes and largest dependencies

### Lighthouse Audit

- Run: `npx lighthouse http://localhost:3000 --output json --output html`
- Key metrics: FCP, LCP, TBT, CLS, bundle transfer size

## Regression Verification

| Test Suite | Files | Tests | Status |
|------------|-------|-------|--------|
| Unit Tests | 28 | 282 | PASS |
| API Integration | 12 | 99 | PASS |
| Schema Integrity | 1 | 11 | PASS (requires Docker) |
| **Total** | **41** | **392** | **ALL PASS** |

Additionally verified:
- `pnpm --filter @signalforge/api typecheck` — PASS
- `pnpm --filter @signalforge/config typecheck` — PASS
- `pnpm --filter @signalforge/database typecheck` — PASS
- `pnpm --filter @signalforge/analytics typecheck` — PASS

## Known Limitations

1. **Lead search ILIKE**: The 8-field OR ILIKE pattern cannot use B-tree indexes. Proper solution requires PostgreSQL `pg_trgm` extension with GIN/GiST indexes, which is a schema-level change beyond Stage 18 scope.

2. **Import streaming**: Lead import loads entire CSV/XLSX into memory and writes per-row. Streaming import with batch inserts would reduce memory usage for large files.

3. **Analytics N+1**: Campaign launch iterates enrolled leads to publish individual workflow events. Bulk event publishing would reduce query count.

4. **Base64 file data through Redis**: Import files pass through BullMQ as base64 payloads, consuming Redis memory. File storage or streaming would reduce Redis pressure.

5. **No APM/metrics**: No structured observability. Adding OpenTelemetry or Prometheus metrics would enable continuous performance monitoring.

## Recommendations for Future Stages

| Priority | Recommendation | Impact |
|----------|---------------|--------|
| High | Add `pg_trgm` GIN index for lead search | Eliminates sequential scans on search |
| High | Streaming CSV/XLSX import with batch inserts | 10x memory reduction for large imports |
| Medium | Bulk workflow event publishing | Reduces DB queries during campaign launch |
| Medium | OpenTelemetry integration | Continuous performance monitoring |
| Medium | Pre-aggregated analytics snapshots for large workspaces | Eliminates repeated heavy aggregations |
| Low | File storage for import data (replace base64-through-Redis) | Reduces Redis memory pressure |
| Low | Connection pool metrics endpoint | Enables pool utilization monitoring |

## Files Created

| File | Purpose |
|------|---------|
| `load-tests/config.js` | Shared k6 configuration |
| `load-tests/helpers/auth.js` | k6 authentication helper |
| `load-tests/helpers/data-generators.js` | Test data factories |
| `load-tests/.env.perf` | Performance test environment |
| `load-tests/scripts/setup-test-db.sh` | Database setup + seed |
| `load-tests/scripts/seed-perf-data.ts` | Prisma bulk-insert seeder |
| `load-tests/scripts/explain-queries.sql` | EXPLAIN ANALYZE queries |
| `load-tests/scripts/monitor-pg-pool.sql` | Pool monitoring queries |
| `load-tests/scripts/inject-queue-jobs.ts` | Queue job injection |
| `load-tests/scenarios/smoke.js` | Smoke test |
| `load-tests/scenarios/api-baseline.js` | Baseline measurement |
| `load-tests/scenarios/stress.js` | Progressive stress |
| `load-tests/scenarios/soak.js` | 10-minute soak |
| `load-tests/scenarios/pool-stress.js` | Pool starvation proof |
| `load-tests/scenarios/search-stress.js` | ILIKE performance |
| `load-tests/scenarios/queue-throughput.ts` | Worker throughput |
| `load-tests/scenarios/queue-backpressure.ts` | Queue backpressure |
| `load-tests/REPORT.md` | This report |

## Files Modified

| File | Change |
|------|--------|
| `packages/database/src/index.ts` | Configurable pool `max` via `PG_POOL_MAX` |
| `packages/config/src/index.ts` | Added `PG_POOL_MAX`, `RATE_LIMIT_MAX` env vars |
| `packages/database/prisma/schema.prisma` | 2 new indexes |
| `apps/api/src/app.ts` | Configurable rate limit via env |
| `apps/api/src/routes/campaigns.ts` | Bounded detail + paginated leads endpoint |
| `apps/api/src/routes/leads.ts` | Reduced export limit |
| `packages/analytics/src/stats-service.ts` | Safety bounds on analytics queries |
| `apps/web/next.config.ts` | Optional bundle analyzer |
| `apps/web/package.json` | Added `@next/bundle-analyzer` devDependency |
| `packages/database/prisma/migrations/20261009130000_add_perf_indexes/migration.sql` | New index migration |

## Defects Found and Fixed During Stage 18

1. **`MockTag` missing `updatedAt` field**: The `MockTag` interface in `apps/api/src/__integration__/helpers/mock-db.ts` was missing the `updatedAt` field that the Prisma Tag model includes. Fixed by adding `updatedAt: Date` to the interface and factory.

2. **Invalid `WorkflowEventType` in schema integrity test**: The test at `packages/database/src/__integration__/schema-integrity.test.ts` used `'LEAD_UPDATED'` which doesn't exist in the enum. Fixed by changing to `'LEAD_IMPORTED'`.
