#!/usr/bin/env bash
#
# Restores receipts (GitLab #82) from the backup mirror into the `receipts`
# volume. Run it on the Docker host, from anywhere in the checkout, after
# restoring the database (restore.sh), so the receipts the database lists
# have their files.
#
#   scripts/backup/receipts-restore.sh [--dry-run] MIRROR_DIR
#
# MIRROR_DIR is the `receipts` folder in the backup directory, e.g.
# /mnt/backups/vacation-home/receipts. Only files the volume lacks are
# copied, each checked against its SHA-256 name; nothing is deleted, so it is
# safe to re-run and to run on a live system. Files the restored database
# does not list are removed by the app's daily cleanup.
#
# It runs the copy in the app's image (`docker compose run`), which has the
# volume mounted where the app keeps it.

set -euo pipefail

dry_run=""
if [ "${1:-}" = "--dry-run" ]; then
  dry_run="--dry-run"
  shift
fi
[ $# -eq 1 ] || { echo "Usage: $(basename "$0") [--dry-run] MIRROR_DIR" >&2; exit 2; }
mirror=$(cd "$1" && pwd)
[ -d "$mirror/files" ] || { echo "No receipts mirror in $mirror (expected $mirror/files)" >&2; exit 2; }

cd "$(dirname "$0")/../.."
here="$PWD/scripts/backup"

# The copy runs as the image's user, so the files belong to the app.
docker compose run --rm --no-deps -T \
  -v "$mirror/files:/mirror:ro" \
  -v "$here:/opt/backup:ro" \
  --entrypoint sh \
  app /opt/backup/receipts-copy.sh $dry_run /mirror /data/receipts
