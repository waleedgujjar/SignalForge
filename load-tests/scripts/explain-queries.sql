-- Stage 18: EXPLAIN ANALYZE queries for performance analysis
-- Run against signalforge_perf after seeding:
--   psql -h localhost -p 5435 -U signalforge -d signalforge_perf -f explain-queries.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Lead search ILIKE (8-field OR clause)
--    Source: apps/api/src/routes/leads.ts — GET /leads?search=<term>
-- ═══════════════════════════════════════════════════════════════════════════════
\echo '=== Query 1: Lead search ILIKE ==='
EXPLAIN ANALYZE
SELECT * FROM "Lead"
WHERE "workspaceId" = 'perf-ws-001'
  AND (
    "email" ILIKE '%ali%'
    OR "firstName" ILIKE '%ali%'
    OR "lastName" ILIKE '%ali%'
    OR "fullName" ILIKE '%ali%'
    OR "company" ILIKE '%ali%'
    OR "phone" ILIKE '%ali%'
    OR "website" ILIKE '%ali%'
    OR "companyDomain" ILIKE '%ali%'
  )
ORDER BY "createdAt" DESC
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Analytics overview — delivery event aggregation
--    Source: packages/analytics/src/stats-service.ts
-- ═══════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== Query 2: Analytics delivery event aggregation ==='
EXPLAIN ANALYZE
SELECT "eventType", count(*)
FROM "EmailDeliveryEvent"
WHERE "workspaceId" = 'perf-ws-001'
  AND "occurredAt" BETWEEN NOW() - INTERVAL '7 days' AND NOW()
GROUP BY "eventType";

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. EmailMessage by leadId (attributeReplies — missing index)
--    Source: packages/analytics/src/stats-service.ts — attributeReplies
-- ═══════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== Query 3: EmailMessage by leadId (missing index) ==='
EXPLAIN ANALYZE
SELECT * FROM "EmailMessage"
WHERE "workspaceId" = 'perf-ws-001'
  AND "leadId" IN ('perf-lead-0001', 'perf-lead-0002', 'perf-lead-0003')
  AND "sentAt" IS NOT NULL
ORDER BY "sentAt" ASC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. CampaignLead by leadId (lead detail — missing index)
--    Source: apps/api/src/routes/leads.ts — GET /leads/:id
-- ═══════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== Query 4: CampaignLead by leadId (missing index) ==='
EXPLAIN ANALYZE
SELECT * FROM "CampaignLead"
WHERE "leadId" = 'perf-lead-0001';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. computeDailyBuckets — unbounded delivery event fetch
--    Source: packages/analytics/src/stats-service.ts — computeDailyBuckets
-- ═══════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== Query 5: computeDailyBuckets unbounded fetch ==='
EXPLAIN ANALYZE
SELECT "occurredAt", "eventType", "bounceType"
FROM "EmailDeliveryEvent"
WHERE "workspaceId" = 'perf-ws-001'
  AND "occurredAt" BETWEEN NOW() - INTERVAL '30 days' AND NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. getCompanySizeRows — 20k enrichment JOIN
--    Source: packages/analytics/src/stats-service.ts — getCompanySizeRows
-- ═══════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== Query 6: getCompanySizeRows enrichment JOIN ==='
EXPLAIN ANALYZE
SELECT le.*, l."status"
FROM "LeadEnrichment" le
JOIN "Lead" l ON le."leadId" = l.id
WHERE le."workspaceId" = 'perf-ws-001'
  AND le."companyProfile" IS NOT NULL
LIMIT 20000;
