-- The app's heaviest reads, explained against real data (GitLab #97).
-- Run through scripts/perf/explain.sh. Read-only: EXPLAIN ANALYZE runs these
-- SELECTs, which change nothing. Each mirrors what the app asks Prisma for;
-- the parameters are a typical property and today's dates.

\set QUIET on
\pset pager off
SELECT id AS property FROM properties WHERE archived_at IS NULL ORDER BY created_at LIMIT 1 \gset
\set QUIET off

\echo '=== 1. Calendar: one property, six weeks of bookings and blocks'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, check_in, check_out, status FROM bookings
WHERE property_id = :'property' AND status <> 'cancelled'
  AND check_in < current_date + 42 AND check_out > current_date - 7;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, start_date, end_date FROM blocks
WHERE property_id = :'property' AND start_date < current_date + 42 AND end_date > current_date - 7;

\echo '=== 2. Bookings list: upcoming stays, all properties, first page and count'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT b.id FROM bookings b JOIN guests g ON g.id = b.guest_id
WHERE b.check_out >= current_date ORDER BY b.check_in, b.id LIMIT 25;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM bookings WHERE check_out >= current_date;

\echo '=== 3. Bookings list: guest search'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT b.id FROM bookings b JOIN guests g ON g.id = b.guest_id
WHERE g.name ILIKE '%mar%' OR g.email ILIKE '%mar%'
ORDER BY b.check_in DESC LIMIT 25;

\echo '=== 4. Ledger: this month, all properties, oldest first'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM transactions
WHERE date >= date_trunc('month', current_date) AND date < date_trunc('month', current_date) + interval '1 month'
ORDER BY date, created_at, id LIMIT 200;

\echo '=== 5. Dashboard: a year of income and expenses by day, and expenses by category'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT date, type, sum(amount_minor) FROM transactions
WHERE property_id IN (SELECT id FROM properties WHERE archived_at IS NULL)
  AND date >= current_date - 365 AND date < current_date
GROUP BY date, type;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT category_id, sum(amount_minor) FROM transactions
WHERE property_id IN (SELECT id FROM properties WHERE archived_at IS NULL)
  AND type = 'expense' AND date >= current_date - 365 AND date < current_date
GROUP BY category_id;

\echo '=== 6. Dashboard: a year of confirmed stays (occupancy)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT property_id, check_in, check_out, total_amount_minor FROM bookings
WHERE status = 'confirmed' AND check_in < current_date AND check_out > current_date - 365;

\echo '=== Table sizes'
SELECT relname AS "table", n_live_tup AS "rows", seq_scan AS "seq scans so far",
       idx_scan AS "index scans so far"
FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 12;
