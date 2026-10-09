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

set -eu

here=$(dirname "$0")
dry_run=""
[ "${1:-}" = "--dry-run" ] && dry_run="--dry-run"
receipts=${RECEIPTS_DIR:?set RECEIPTS_DIR}
mirror=${MIRROR_DIR:?set MIRROR_DIR}
keep_days=${KEEP_DAYS:-186}

[ -n "$dry_run" ] || mkdir -p "$mirror/files" "$mirror/gone"
status=0
"$here/receipts-copy.sh" $dry_run "$receipts" "$mirror/files" || status=$?

# Files no longer in the app: note when they went, delete them KEEP_DAYS later.
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
echo "Receipts mirror: $pruned removed after $keep_days days."
exit "$status"
