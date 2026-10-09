#!/usr/bin/env bash
#
# Explains the app's heaviest reads against the live database (GitLab #97),
# to see whether real data needs more indexes. Run on the Docker host, from
# anywhere in the checkout:
#
#   scripts/perf/explain.sh              the plans, then a summary
#   scripts/perf/explain.sh --dry-run    print the command, run nothing
#
# Read-only (scripts/perf/explain.sql: EXPLAIN ANALYZE of SELECTs). Safe to
# run on a live system and to repeat. The full plans go to
# perf-explain-<UTC time>.txt; the summary lists sequential scans on tables
# with more than MIN_ROWS rows (default 10000) - the ones an index might help.
# A sequential scan of a small table is the right plan, not a problem.

set -euo pipefail

min_rows=${MIN_ROWS:-10000}
cd "$(dirname "$0")/../.."
out="perf-explain-$(date -u +%Y%m%d_%H%M%S).txt"
command=(docker compose exec -T db psql -U vacation -d vacation_home -v ON_ERROR_STOP=1 -f -)

if [ "${1:-}" = "--dry-run" ]; then
  echo "Would run: ${command[*]} < scripts/perf/explain.sql > $out"
  exit 0
fi

"${command[@]}" < scripts/perf/explain.sql > "$out"
echo "Plans written to $out"

# Rows per table, from the table-size listing at the end.
declare -A rows=()
while read -r table count; do
  rows[$table]=$count
done < <(awk -F'|' '/^=== Table sizes/{on=1;next} on && NF>=2 {gsub(/ /,"",$1); gsub(/ /,"",$2); if ($2 ~ /^[0-9]+$/) print $1, $2}' "$out")

echo
echo "Sequential scans on tables over $min_rows rows:"
found=0
while read -r table; do
  if [ "${rows[$table]:-0}" -gt "$min_rows" ]; then
    echo "  $table (${rows[$table]} rows): see $out"
    found=1
  fi
done < <(grep -oE 'Seq Scan on [a-z_]+' "$out" | awk '{print $4}' | sort -u)
[ "$found" -eq 1 ] || echo "  none - the indexes cover these reads."
