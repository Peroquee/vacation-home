#!/usr/bin/env bash
#
# Restores a backup made by the `backup` compose service into a database of
# the `db` service. Run it on the Docker host, from anywhere in the checkout.
#
#   scripts/backup/restore.sh BACKUP_FILE                  rehearsal (default)
#   scripts/backup/restore.sh --target vacation_home BACKUP_FILE    the real one
#
# By default it restores into a separate scratch database,
# vacation_home_restore_test, and leaves the live one alone: that is the
# rehearsal docs/backup-and-restore.md asks for. Restoring over the live
# database needs `--target vacation_home` and a typed confirmation (or
# --yes); the app is stopped for it and started again afterwards.
#
# Safe to re-run: the target database is dropped and created afresh each
# time, so a run that failed halfway is simply repeated. --dry-run checks the
# file and prints every command that would change something, changing nothing.
#
# Guests erased (DSGVO) after the backup was taken come back with it. Before
# restoring over the live database the script saves the ids of every erased
# guest, and afterwards lists those the restore brought back, to be erased
# again. See "After a restore" in docs/backup-and-restore.md.

set -Eeuo pipefail

LIVE_DB="vacation_home"
SCRATCH_DB="vacation_home_restore_test"
DB_USER="vacation"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--target DATABASE] [--yes] BACKUP_FILE

  BACKUP_FILE        a .sql.gz from the backup directory, e.g.
                     /mnt/backups/vacation-home/daily/vacation_home-latest.sql.gz
  --target DATABASE  where to restore (default: $SCRATCH_DB, a rehearsal;
                     use $LIVE_DB to replace the live data)
  --yes              do not ask before replacing the live database
  --dry-run          check the file and print what would be done, change nothing
EOF
}

dry_run=false
assume_yes=false
target="$SCRATCH_DB"
file=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    --target)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      target="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      [ -z "$file" ] || { echo "Only one backup file, please." >&2; exit 2; }
      file="$1"
      ;;
  esac
  shift
done

[ -n "$file" ] || { usage >&2; exit 2; }
# A database name goes into SQL below; allow only plain identifiers.
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Not a valid database name: $target" >&2; exit 2; }

step() { printf '\n==> %s\n' "$*"; }
# Runs a command that changes something, or only shows it on --dry-run.
change() {
  if $dry_run; then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# Everything runs through Compose, from the checkout's root.
cd "$(dirname "$0")/../.."
compose() { docker compose "$@"; }
psql_in() {
  local db="$1"
  shift
  compose exec -T db psql -v ON_ERROR_STOP=1 -X -q -U "$DB_USER" -d "$db" "$@"
}

step "Checking the backup file"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
# Reading it end to end catches a truncated or corrupt file before anything
# is dropped.
gzip -t "$file"
echo "    $file: $(du -h "$file" | cut -f1), intact"

step "Checking that the database server is running"
if ! compose exec -T db pg_isready -q -U "$DB_USER"; then
  echo "The db service is not running. Start it with: docker compose up -d db" >&2
  exit 1
fi
echo "    db is up"

live=false
[ "$target" = "$LIVE_DB" ] && live=true

erasures=""
if $live; then
  if ! $assume_yes && ! $dry_run; then
    echo
    echo "This REPLACES all data in the live database '$LIVE_DB' with the backup."
    read -r -p "Type the database name to continue: " answer
    [ "$answer" = "$LIVE_DB" ] || { echo "Not confirmed; nothing changed."; exit 1; }
  fi

  step "Saving the ids of erased guests (DSGVO) from the current database"
  erasures="$(mktemp "${TMPDIR:-/tmp}/vacation-home-erasures.XXXXXX")"
  # Read-only, so it runs on --dry-run too. Ids only: no personal data.
  if psql_in "$LIVE_DB" -A -t -c \
    "SELECT DISTINCT subject_id FROM audit_events
     WHERE subject_type = 'guest' AND action IN ('guest.purged', 'guest.deleted')" \
    >"$erasures" 2>/dev/null; then
    echo "    $(wc -l <"$erasures") erased guest(s) on record, saved to $erasures"
  else
    echo "    The current database could not be read, so erasures cannot be"
    echo "    carried over automatically. Follow 'After a restore' in the docs."
    rm -f "$erasures"
    erasures=""
  fi

  step "Stopping the app, so nothing writes while the data is replaced"
  change compose stop app
  # If anything below fails, say so plainly: the app stays stopped until the
  # restore succeeds or someone starts it.
  $dry_run || trap 'echo >&2; echo "Restore FAILED. The app is stopped. Fix the problem and run this again, or start the app with: docker compose start app" >&2' ERR
fi

step "Recreating the database '$target'"
# WITH (FORCE) ends any session still connected; the server is PostgreSQL 16.
change psql_in postgres -c "DROP DATABASE IF EXISTS \"$target\" WITH (FORCE)"
change psql_in postgres -c "CREATE DATABASE \"$target\" OWNER \"$DB_USER\""

step "Restoring $file into '$target'"
if $dry_run; then
  printf '    [dry-run] gunzip -c %q | psql -d %s\n' "$file" "$target"
else
  gunzip -c "$file" | psql_in "$target"
fi

step "Checking the restored data"
if $dry_run; then
  echo "    [dry-run] would count properties, guests and bookings in '$target'"
else
  psql_in "$target" -c \
    "SELECT (SELECT count(*) FROM properties) AS properties,
            (SELECT count(*) FROM guests) AS guests,
            (SELECT count(*) FROM bookings) AS bookings,
            (SELECT max(finished_at) FROM _prisma_migrations) AS last_migration"
fi

if [ -n "$erasures" ]; then
  step "Looking for erased guests the backup brought back"
  if $dry_run; then
    echo "    [dry-run] would compare $erasures with the restored guests"
  else
    back="$(
      # The saved ids, against guests that exist again un-erased.
      { echo "CREATE TEMP TABLE erased (id uuid);"
        echo "COPY erased FROM STDIN;"
        cat "$erasures"
        printf '\\.\n'
        echo "SELECT g.id FROM guests g JOIN erased e ON e.id = g.id WHERE g.purged_at IS NULL;"
      } | psql_in "$target" -A -t
    )"
    if [ -n "$back" ]; then
      echo "    These guests were erased after the backup was taken and are back."
      echo "    Erase them again NOW (docs: 'After a restore'):"
      # One id per line; word splitting is intended.
      # shellcheck disable=SC2086
      printf '      %s\n' $back
    else
      echo "    None. Every erasure on record is still in effect."
    fi
  fi
fi

if $live; then
  step "Starting the app again (it applies any newer migrations on start)"
  change compose start app
fi

if $dry_run; then
  printf '\nDry run finished: nothing was changed.\n'
elif $live; then
  printf '\nRestore finished. Check the app in the browser.\n'
else
  printf '\nRehearsal finished. Remove the scratch database when done with:\n'
  printf '  docker compose exec db dropdb -U %s %s\n' "$DB_USER" "$target"
fi
