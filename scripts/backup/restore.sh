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
# database needs `--target vacation_home` and a typed confirmation (or --yes).
#
# The backup is always restored into a staging database, <target>_restoring,
# and checked there first. Only then is it swapped in: the app is stopped,
# the live database is renamed to <target>_pre_restore_<UTC time> and kept,
# the staging one takes its name, and the app is started again. A dump that
# does not restore cleanly therefore never touches the live database.
#
# Safe to re-run: the staging database is dropped and created afresh each
# time, so a run that failed is simply repeated. --dry-run checks the file and
# prints every command that would change something, changing nothing.
#
# Guests erased (DSGVO) after the backup was taken come back with it. Before
# a live restore the script saves the ids of every erased guest, and writes
# those the restore brought back to a file, to be erased again. See "After a
# restore" in docs/backup-and-restore.md.

set -euo pipefail

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
# Database names go into SQL below; allow only plain identifiers, short
# enough to take the suffixes (PostgreSQL's limit is 63 characters).
[[ "$target" =~ ^[a-z_][a-z0-9_]{0,30}$ ]] || { echo "Not a valid database name: $target" >&2; exit 2; }

stamp="$(date -u +%Y%m%d_%H%M%S)"
staging="${target}_restoring"
kept="${target}_pre_restore_${stamp}"
live=false
[ "$target" = "$LIVE_DB" ] && live=true

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
sql() { psql_in postgres -c "$1"; }
exists() {
  [ "$(psql_in postgres -A -t -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]
}

# What to say if a step fails, set once the first change is near and updated
# as the run goes on. Empty while failing changes nothing (bad arguments, a
# refused confirmation).
on_failure=""
trap 'status=$?; [ "$status" -eq 0 ] || [ -z "$on_failure" ] || printf "\nRestore FAILED. %s\n" "$on_failure" >&2' EXIT

step "Checking the backup file"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
# Reading it end to end catches a truncated or corrupt file early.
gzip -t "$file"
echo "    $file: $(du -h "$file" | cut -f1), intact"

step "Checking that the database server is running"
if ! compose exec -T db pg_isready -q -U "$DB_USER"; then
  echo "The db service is not running. Start it with: docker compose up -d db" >&2
  exit 1
fi
echo "    db is up"

if $live && ! $assume_yes && ! $dry_run; then
  echo
  echo "This REPLACES all data in the live database '$LIVE_DB' with the backup."
  echo "The current data is kept as '$kept' until you drop it."
  read -r -p "Type the database name to continue: " answer
  [ "$answer" = "$LIVE_DB" ] || { echo "Not confirmed; nothing changed."; exit 1; }
fi

# Ids only, no personal data: kept beside the checkout, not in /tmp, so they
# survive a reboot.
erasure_dir="backups-restore"
erased_file=""
if $live; then
  step "Saving the ids of erased guests (DSGVO) from the current database"
  if exists "$LIVE_DB" && records="$(psql_in "$LIVE_DB" -A -t -c \
    "SELECT DISTINCT subject_id FROM audit_events
     WHERE subject_type = 'guest' AND action IN ('guest.purged', 'guest.deleted')" 2>/dev/null)"; then
    erased_file="$erasure_dir/erased-guests-$stamp.txt"
    if $dry_run; then
      echo "    [dry-run] would save $(grep -c . <<<"$records" || true) id(s) to $erased_file"
    else
      mkdir -p "$erasure_dir"
      printf '%s\n' "$records" | grep . >"$erased_file" || true
      echo "    $(wc -l <"$erased_file") erased guest(s) on record, saved to $erased_file"
    fi
  else
    echo "    The current database could not be read, so erasures cannot be"
    echo "    carried over automatically. Follow 'After a restore' in the docs."
  fi
fi

on_failure="The live database was not touched. Fix the problem and run this again."

step "Creating the staging database '$staging'"
# WITH (FORCE) ends any session still connected; the server is PostgreSQL 16.
change sql "DROP DATABASE IF EXISTS \"$staging\" WITH (FORCE)"
change sql "CREATE DATABASE \"$staging\" OWNER \"$DB_USER\""

step "Restoring $file into '$staging' (the app keeps running meanwhile)"
if $dry_run; then
  printf '    [dry-run] gunzip -c %q | psql -d %s\n' "$file" "$staging"
else
  gunzip -c "$file" | psql_in "$staging"
fi

step "Checking the restored data"
if $dry_run; then
  echo "    [dry-run] would count properties, guests and bookings in '$staging'"
else
  psql_in "$staging" -c \
    "SELECT (SELECT count(*) FROM properties) AS properties,
            (SELECT count(*) FROM guests) AS guests,
            (SELECT count(*) FROM bookings) AS bookings,
            (SELECT max(finished_at) FROM _prisma_migrations) AS last_migration"
fi

back_file=""
if [ -n "$erased_file" ]; then
  step "Looking for erased guests the backup brought back"
  if $dry_run; then
    echo "    [dry-run] would compare $erased_file with the restored guests"
  else
    back="$(
      # The saved ids, against guests that exist again un-erased.
      { echo "CREATE TEMP TABLE erased (id uuid);"
        echo "COPY erased FROM STDIN;"
        cat "$erased_file"
        printf '\\.\n'
        echo "SELECT g.id FROM guests g JOIN erased e ON e.id = g.id WHERE g.purged_at IS NULL;"
      } | psql_in "$staging" -A -t
    )"
    if [ -n "$back" ]; then
      back_file="$erasure_dir/erase-again-$stamp.txt"
      printf '%s\n' "$back" >"$back_file"
      echo "    $(wc -l <"$back_file") guest(s) were erased after the backup was taken and are"
      echo "    back. Their ids are in $back_file."
    else
      echo "    None. Every erasure on record is still in effect."
    fi
  fi
fi

if $live; then
  step "Stopping the app, so nothing writes during the swap"
  change compose stop app
  on_failure="The app is stopped. If the live database is still '$target', start the app again with: docker compose start app. If it was already renamed, rename it back first: docker compose exec db psql -U $DB_USER -d postgres -c 'ALTER DATABASE \"$kept\" RENAME TO \"$target\"'"
fi

step "Swapping in the restored database"
if $dry_run || exists "$target"; then
  # A rename needs the database to itself; the app is stopped, end anything else.
  change sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid()"
  if $live; then
    change sql "ALTER DATABASE \"$target\" RENAME TO \"$kept\""
  else
    # A rehearsal's previous copy is worth nothing.
    change sql "DROP DATABASE \"$target\" WITH (FORCE)"
  fi
fi
change sql "ALTER DATABASE \"$staging\" RENAME TO \"$target\""

if $live; then
  step "Starting the app again (it applies any newer migrations on start)"
  on_failure="The restored database is in place as '$target'; the app did not start. Try: docker compose start app"
  change compose start app
fi

if $dry_run; then
  printf '\nDry run finished: nothing was changed.\n'
  exit 0
fi

if $live; then
  printf '\nRestore finished. Check the app in the browser.\n'
  if [ -n "$back_file" ]; then
    printf '\nERASE THESE GUESTS AGAIN NOW, before anyone uses the app:\n'
    if grep -qs '^COMPOSE_FILE=.*compose\.prod\.yml' .env; then
      # Production: the app image has no npm scripts; the tools image does,
      # and needs the saved ids mounted in.
      printf '  docker compose run --rm -v "$PWD/%s:/app/%s:ro" migrate npm run guests:repurge -- %s\n' \
        "$erasure_dir" "$erasure_dir" "$back_file"
    else
      printf '  docker compose exec app npm run guests:repurge -- %s\n' "$back_file"
    fi
    printf 'It prints how many were erased again. Running it twice is harmless.\n'
    printf '(More: docs/backup-and-restore.md, "After a restore")\n'
  fi
  printf '\nThe previous data is kept as the database "%s".\n' "$kept"
  printf 'It holds personal data, including guests erased since the backup.\n'
  printf 'Drop it as soon as the restored app is confirmed working:\n'
  printf '  docker compose exec db dropdb -U %s %s\n' "$DB_USER" "$kept"
else
  printf '\nRehearsal finished. Remove the scratch database when done with:\n'
  printf '  docker compose exec db dropdb -U %s %s\n' "$DB_USER" "$target"
fi
