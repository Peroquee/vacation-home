#!/usr/bin/env bash
#
# Deploys a version of the app on this server, or rolls back to an earlier
# one. Run from anywhere in the checkout on the Docker host; the GitLab CI
# deploy job runs it over SSH after every merge to main.
#
#   scripts/deploy/deploy.sh                      deploy what origin/main has now
#   scripts/deploy/deploy.sh --ref <commit>       deploy that commit
#   scripts/deploy/deploy.sh --rollback <commit>  switch back to an earlier build
#   scripts/deploy/deploy.sh --dry-run ...        show what would happen
#
# A deploy: check out the commit, build its images (tagged with the commit),
# apply the database migrations with the new code, then point "current" at
# the new build and restart the app. Everything slow happens while the old
# version keeps serving; the restart itself takes seconds, during which the
# reverse proxy holds requests until the app is ready again.
#
# Safe to re-run: building an existing tag is a no-op apart from checking
# it, migrations apply only what is pending, and restarting onto the version
# already running changes nothing. If a step fails, the version that was
# running keeps running. The last five app builds are kept for rollbacks,
# and the last two tools builds (migrations run forward only). Docker's
# build cache is capped by size (DEPLOY_BUILD_CACHE_MAX, default 4gb, from
# the environment or .env), so frequent deploys cannot fill the disk.
#
# Rolling back switches the app to an earlier build without touching the
# database. That is only safe if no migration since then removed or changed
# something the old code needs (ours only add); otherwise restore the backup
# from before the deploy (docs/deployment.md, "Rolling back").

set -euo pipefail

# A deploy checks out new code, which may replace this very file while bash
# is still reading it. So run from a copy, and point it back at the checkout.
if [ -z "${DEPLOY_CHECKOUT:-}" ]; then
  checkout="$(cd "$(dirname "$0")/../.." && pwd)"
  copy="$(mktemp "${TMPDIR:-/tmp}/vacation-home-deploy.XXXXXX")"
  cp "$0" "$copy"
  DEPLOY_CHECKOUT="$checkout" exec bash "$copy" "$@"
fi
trap 'rm -f "$0"' EXIT

usage() {
  sed -n '3,12p' "$DEPLOY_CHECKOUT/scripts/deploy/deploy.sh" | sed 's/^# \{0,1\}//'
}

dry_run=false
ref=""
rollback=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --ref)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      ref="$2"
      shift
      ;;
    --rollback)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      rollback="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[ -z "$ref" ] || [ -z "$rollback" ] || { echo "Use --ref or --rollback, not both." >&2; exit 2; }

KEEP=5
# Tools images only run migrations and maintenance; a rollback needs none.
KEEP_TOOLS=2

cd "$DEPLOY_CHECKOUT"
step() { printf '\n==> %s\n' "$*"; }
change() {
  if $dry_run; then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

[ -f .env ] || { echo "No .env here; see docs/deployment.md, step 3." >&2; exit 1; }
grep -qs '^COMPOSE_FILE=.*compose\.prod\.yml' .env ||
  { echo "This .env does not select compose.prod.yml; see docs/deployment.md." >&2; exit 1; }

# The most disk Docker's build cache may keep after a deploy: the
# environment's DEPLOY_BUILD_CACHE_MAX, else .env's, else 4gb. Checked now,
# before anything changes, so a typo fails the deploy rather than the prune.
cache_max="${DEPLOY_BUILD_CACHE_MAX:-$(sed -n 's/^DEPLOY_BUILD_CACHE_MAX=//p' .env | tr -d '"')}"
cache_max="${cache_max:-4gb}"
[[ "$cache_max" =~ ^[0-9]+(\.[0-9]+)?([kKmMgGtT]?[bB])?$ ]] ||
  { echo "DEPLOY_BUILD_CACHE_MAX must be a size like 4gb or 500mb, not '$cache_max'." >&2; exit 2; }

# Which profiles are in use (https: Caddy; backup: the backups), from .env.
profiles="$(sed -n 's/^COMPOSE_PROFILES=//p' .env | tr -d '"')"

# The commit "current" points at: the other tag on the same image.
current_sha() {
  local id
  id="$(docker image inspect vacation-home:current --format '{{.Id}}' 2>/dev/null)" || return 0
  docker images vacation-home --no-trunc --format '{{.ID}} {{.Tag}}' |
    awk -v id="$id" '$1 == id && $2 != "current" { print $2; exit }'
}

# Waits until the app answers /api/ready on this machine, up to two minutes.
wait_ready() {
  local port
  port="$(sed -n 's/^APP_LOCAL_PORT=//p' .env | tr -d '"')"
  port="${port:-3000}"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${port}/api/ready" >/dev/null 2>&1; then
      echo "    the app is ready"
      return 0
    fi
    sleep 2
  done
  echo "The app did not become ready; see: docker compose logs --tail 100 app" >&2
  return 1
}

if [ -n "$rollback" ]; then
  sha="$(git rev-parse --short "$rollback")"
  step "Rolling back to $sha"
  docker image inspect "vacation-home:$sha" >/dev/null 2>&1 ||
    { echo "No build of $sha is kept here. Kept builds:" >&2; docker images vacation-home --format '  {{.Tag}}' >&2; exit 1; }
  change docker tag "vacation-home:$sha" vacation-home:current
  # Fewer tools builds are kept; without one, "current" stays as it is.
  if docker image inspect "vacation-home-tools:$sha" >/dev/null 2>&1; then
    change docker tag "vacation-home-tools:$sha" vacation-home-tools:current
  fi
  change docker compose up -d app
  $dry_run || wait_ready
  printf '\nRolled back to %s. The database was not changed.\n' "$sha"
  exit 0
fi

step "Fetching the code"
change git fetch --quiet origin
target="${ref:-origin/main}"
sha="$(git rev-parse --short "$target" 2>/dev/null || true)"
if [ -z "$sha" ]; then
  # On a dry run before the first fetch, the commit may not be known yet.
  $dry_run && sha="<new>" || { echo "Unknown commit: $target" >&2; exit 1; }
fi
echo "    deploying $sha"
change git checkout --quiet --detach "$target"

step "Building the images (the running version keeps serving)"
build_args=()
for name in NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_SENTRY_ENVIRONMENT; do
  value="$(sed -n "s/^${name}=//p" .env | tr -d '"')"
  [ -z "$value" ] || build_args+=(--build-arg "${name}=${value}")
done
build_args+=(--build-arg "SENTRY_RELEASE=${sha}")
change docker build --quiet --target app -t "vacation-home:$sha" "${build_args[@]}" .
change docker build --quiet --target tools -t "vacation-home-tools:$sha" "${build_args[@]}" .
if [[ ",$profiles," == *",https,"* ]]; then
  change docker compose build --quiet caddy
fi

if [[ ",$profiles," == *",backup,"* ]]; then
  # Docker would create a missing folder as root, and the backup services
  # (user 999) could not write to it.
  step "Checking the backup folder"
  backup_dir="$(sed -n 's/^BACKUP_HOST_DIR=//p' .env | tr -d '"')"
  check=(bash scripts/deploy/backup-dir.sh)
  $dry_run && check+=(--dry-run)
  "${check[@]}" "${backup_dir:-./backups}"
fi

step "Applying database migrations"
change docker compose up -d db
# The new code's migrations: APP_TAG picks the new tools image.
change env APP_TAG="$sha" docker compose run --rm migrate

step "Switching to $sha"
previous="$(current_sha)"
change docker tag "vacation-home:$sha" vacation-home:current
change docker tag "vacation-home-tools:$sha" vacation-home-tools:current
# Recreates the app only if its image changed; starts anything not running.
change docker compose up -d
$dry_run || wait_ready

step "Keeping the last $KEEP app builds and $KEEP_TOOLS tools builds"
for repo in vacation-home vacation-home-tools; do
  keep=$KEEP
  [ "$repo" = vacation-home ] || keep=$KEEP_TOOLS
  # Newest first; "current" is a second name for one of them, never removed.
  # (`|| true`: with no builds yet, grep finds nothing, which is fine.)
  old="$(docker images "$repo" --format '{{.CreatedAt}}\t{{.Tag}}' |
    { grep -v $'\tcurrent$' || true; } | sort -r | tail -n +"$((keep + 1))" | cut -f2)"
  for tag in $old; do
    change docker image rm --force "$repo:$tag" || true
  done
done
# Layers no kept image uses, then the build cache down to its cap: the most
# recently used entries stay, so the next build of an unchanged lockfile is
# still fast. Age alone was no limit: eight deploys in two days grew a week
# of cache to 15 GB. The flag depends on the Docker version (asking only
# reads, so a dry run asks too): --max-used-space with buildx (Docker 28+),
# --keep-storage before it; with neither, at least what is over a day old.
change docker image prune --force
prune_help="$(docker builder prune --help 2>&1 || true)"
if grep -q -- '--max-used-space' <<<"$prune_help"; then
  step "Trimming Docker's build cache to $cache_max"
  change docker builder prune --force --max-used-space "$cache_max"
elif grep -q -- '--keep-storage' <<<"$prune_help"; then
  step "Trimming Docker's build cache to $cache_max"
  change docker builder prune --force --keep-storage "$cache_max"
else
  step "Trimming Docker's build cache to the last day (no size limit in this Docker)"
  change docker builder prune --force --filter until=24h
fi

if $dry_run; then
  printf '\nDry run finished: nothing was changed.\n'
else
  if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then
    printf '\nDeployed %s. To go back: scripts/deploy/deploy.sh --rollback %s\n' "$sha" "$previous"
  else
    printf '\nDeployed %s.\n' "$sha"
  fi
fi
