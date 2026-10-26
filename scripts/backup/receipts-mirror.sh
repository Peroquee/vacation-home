#!/bin/sh
#
# The daily receipts backup (GitLab #82), run by the `receipts-backup`
# compose service: mirrors RECEIPTS_DIR into MIRROR_DIR/files next to the
# database dumps.
#
#   receipts-mirror.sh [--dry-run]
#
# Receipts never change (each file is named by its SHA-256), so a run copies
# only new files (receipts-copy.sh). A file deleted in the app stays in the
# mirror for KEEP_DAYS more days (default 186, like the monthly dumps), so
# an older dump restores with its receipts; then it goes. Safe to re-run.
#
# A missing or emptied receipts volume must not look like the owner deleted
# everything (GitLab #145): then the run fails and marks nothing as gone.
# Nor does one run mark more than a tenth of the mirror (at least 10 files)
# as gone; above that it fails and asks for RECEIPTS_ALLOW_GONE=1, for the
# one run after a real mass deletion. Each run writes its result to
# MIRROR_DIR/.last-run ("ok" or "failed", the UTC time, the reason), which
# the service's healthcheck reads.

set -eu

here=$(dirname "$0")
dry_run=""
[ "${1:-}" = "--dry-run" ] && dry_run="--dry-run"
receipts=${RECEIPTS_DIR:?set RECEIPTS_DIR}
mirror=${MIRROR_DIR:?set MIRROR_DIR}
keep_days=${KEEP_DAYS:-186}

[ -n "$dry_run" ] || mkdir -p "$mirror/files" "$mirror/gone"

# Ends the run: exit status, then the reason for a failure.
finish() {
  result=ok
  [ "$1" -eq 0 ] || result=failed
  [ -z "${2:-}" ] || echo "Receipts mirror FAILED: $2" >&2
  if [ -z "$dry_run" ]; then
    echo "$result $(date -u +%Y-%m-%dT%H:%M:%SZ)${2:+ $2}" >"$mirror/.last-run.tmp"
    mv "$mirror/.last-run.tmp" "$mirror/.last-run"
  fi
  exit "$1"
}

# Counts the files matching a glob (an unmatched glob stays itself).
count() {
  n=0
  for file in "$@"; do
    [ -f "$file" ] && n=$((n + 1))
  done
  echo "$n"
}

[ -d "$receipts" ] ||
  finish 1 "No receipts folder at $receipts. Is the receipts volume mounted? Nothing marked as gone."

status=0
"$here/receipts-copy.sh" $dry_run "$receipts" "$mirror/files" || status=$?

# Files no longer in the app: note when they went, delete them KEEP_DAYS later.
# First, how many would newly go: an empty or emptied volume, or too many at
# once, is a fault to look at, not an instruction to delete.
mirrored=$(count "$mirror"/files/??/*)
newly_gone=0
for file in "$mirror"/files/??/*; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  folder=$(basename "$(dirname "$file")")
  [ -f "$receipts/$folder/$name" ] || [ -f "$mirror/gone/$name" ] || newly_gone=$((newly_gone + 1))
done
if [ "${RECEIPTS_ALLOW_GONE:-}" != 1 ] && [ "$mirrored" -gt 0 ]; then
  if [ "$(count "$receipts"/??/*)" -eq 0 ]; then
    finish 1 "The receipts folder is empty, but the mirror holds $mirrored. Is the receipts volume mounted? Nothing marked as gone."
  fi
  limit=$((mirrored / 10))
  [ "$limit" -ge 10 ] || limit=10
  if [ "$newly_gone" -gt "$limit" ]; then
    finish 1 "$newly_gone of $mirrored mirrored files are no longer in the app, more than $limit at once. Nothing marked as gone. If they really were deleted, run once with RECEIPTS_ALLOW_GONE=1."
  fi
fi

pruned=0
for file in "$mirror"/files/??/*; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  folder=$(basename "$(dirname "$file")")
  marker="$mirror/gone/$name"
  if [ -f "$receipts/$folder/$name" ]; then
    [ -n "$dry_run" ] || rm -f "$marker"
    continue
  fi
  if [ ! -f "$marker" ]; then
    [ -n "$dry_run" ] || touch "$marker"
  elif [ -n "$(find "$marker" -mtime +"$keep_days")" ]; then
    if [ -n "$dry_run" ]; then
      echo "Would delete $folder/$name (gone for over $keep_days days)"
    else
      rm -f "$file" "$marker"
    fi
    pruned=$((pruned + 1))
  fi
done
echo "Receipts mirror: $newly_gone newly gone, $pruned removed after $keep_days days."
[ "$status" -eq 0 ] || finish "$status" "some receipts could not be copied (broken files, see above)."
finish 0
