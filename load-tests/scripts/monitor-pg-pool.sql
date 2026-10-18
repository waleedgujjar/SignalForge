-- Stage 18: PostgreSQL connection pool monitoring
-- Run in a separate psql session during k6 load tests:
--   psql -h localhost -p 5435 -U signalforge -d signalforge_perf

-- Active connections to the perf database
\echo '=== Active Connections ==='
SELECT count(*) AS total_connections
FROM pg_stat_activity
WHERE datname = 'signalforge_perf';

-- Connection state breakdown
\echo ''
\echo '=== Connection State Breakdown ==='
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = 'signalforge_perf'
GROUP BY state
ORDER BY count(*) DESC;

-- Waiting connections
\echo ''
\echo '=== Waiting Connections ==='
SELECT count(*) AS waiting
FROM pg_stat_activity
WHERE datname = 'signalforge_perf'
  AND wait_event_type IS NOT NULL;

-- Long-running queries (>1s)
\echo ''
\echo '=== Long-Running Queries (>1s) ==='
SELECT pid, now() - query_start AS duration, state, LEFT(query, 100) AS query_prefix
FROM pg_stat_activity
WHERE datname = 'signalforge_perf'
  AND state = 'active'
  AND now() - query_start > INTERVAL '1 second'
ORDER BY duration DESC
LIMIT 10;

-- Lock contention
\echo ''
\echo '=== Lock Contention ==='
SELECT blocked.pid AS blocked_pid,
       blocking.pid AS blocking_pid,
       LEFT(blocked.query, 80) AS blocked_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid
JOIN pg_locks bll ON bll.locktype = bl.locktype
  AND bll.database IS NOT DISTINCT FROM bl.database
  AND bll.relation IS NOT DISTINCT FROM bl.relation
  AND bll.page IS NOT DISTINCT FROM bl.page
  AND bll.tuple IS NOT DISTINCT FROM bl.tuple
  AND bll.pid != bl.pid
JOIN pg_stat_activity blocking ON blocking.pid = bll.pid
WHERE NOT bl.granted
LIMIT 10;
