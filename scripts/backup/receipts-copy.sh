#!/bin/sh
#
# Copies receipt files (GitLab #82) from one receipts tree to another:
# SOURCE/ab/abcdef... to TARGET/ab/abcdef..., only those TARGET lacks. Every
# file is named by its SHA-256, so each copy is checked against its name
# before it counts; a broken source file is reported and skipped.
#
#   receipts-copy.sh [--dry-run] SOURCE TARGET
#
# Used by receipts-mirror.sh (the daily backup) and receipts-restore.sh.
# Plain POSIX sh, for busybox (alpine) and the app's Debian image alike.
# Safe to re-run: files already there are left alone, and a copy is written
# to a temporary name first, so an interrupted run leaves no half file.

set -eu

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
  shift
fi
[ $# -eq 2 ] || { echo "Usage: receipts-copy.sh [--dry-run] SOURCE TARGET" >&2; exit 2; }
source_dir=$1
target_dir=$2
[ -d "$source_dir" ] || { echo "No such directory: $source_dir" >&2; exit 2; }

copied=0
present=0
broken=0
for file in "$source_dir"/??/*; do
  [ -f "$file" ] || continue
  name=$(basename "$file")
  # Only finished files: 64 hex characters, no temporary names.
  case "$name" in
    *[!0-9a-f]* | *.tmp) continue ;;
  esac
  [ ${#name} -eq 64 ] || continue
  folder=$(basename "$(dirname "$file")")
  target="$target_dir/$folder/$name"
  if [ -f "$target" ]; then
    present=$((present + 1))
    continue
  fi
  if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$name" ]; then
    echo "Broken, not copied: $folder/$name" >&2
    broken=$((broken + 1))
    continue
  fi
  if $dry_run; then
    echo "Would copy $folder/$name"
  else
    mkdir -p "$target_dir/$folder"
    cp "$file" "$target.tmp"
    chmod 644 "$target.tmp"
    mv "$target.tmp" "$target"
  fi
  copied=$((copied + 1))
done

verb=copied
$dry_run && verb="to copy"
echo "Receipts: $copied $verb, $present already there, $broken broken."
[ "$broken" -eq 0 ]
