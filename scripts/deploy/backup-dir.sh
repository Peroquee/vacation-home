#!/usr/bin/env bash
#
# Makes sure the backup folder (BACKUP_HOST_DIR) can be written by the
# backup services, which run as user and group 999 (`backup`,
# `receipts-backup`). Docker would otherwise create a missing folder as
# root, and both services would fail and restart in a loop. Called by
# deploy.sh when the `backup` profile is on; safe to run by hand and to
# repeat.
#
#   scripts/deploy/backup-dir.sh [--dry-run] DIR
#
# - Missing local folder: created, owned by 999:999, mode 750.
# - Local folder with another owner: given to 999:999, mode 750.
#   Both need root: run as root, or with sudo that asks no password
#   (`sudo -n`); otherwise it stops and prints the commands to run.
# - Network share (NFS, SMB): only checked, since ownership is set on the
#   NAS. A missing folder stops it. Unless its owner, group or mode already
#   let 999 write, it writes and removes a test file as 999 in a container
#   (alpine, as the receipts backup uses), since the NAS may map owners and
#   modes differently; a folder 999 cannot write stops it (GitLab #145).
#
# BACKUP_UID (default 999) is for tests.

set -euo pipefail

uid=${BACKUP_UID:-999}
dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
  shift
fi
[ $# -eq 1 ] || { echo "Usage: $(basename "$0") [--dry-run] DIR" >&2; exit 2; }
dir=$1

fix_by_hand() {
  cat >&2 <<MSG
The backup folder $dir must belong to user 999 (the backup services).
Run this once, then deploy again:

  sudo mkdir -p '$dir'                  # create the folder if it is missing
  sudo chown 999:999 '$dir'             # give it to the backup services' user
  sudo chmod 750 '$dir'                 # readable only by them (and root)
MSG
  exit 1
}

# Runs a command as root: directly, through sudo without a password, or not
# at all (returns 1). On a dry run it only says what it would run.
as_root() {
  local prefix=()
  [ "$(id -u)" -eq 0 ] || prefix=(sudo -n)
  if $dry_run; then
    echo "    [dry-run] ${prefix[*]:+${prefix[*]} }$*"
    return 0
  fi
  if [ ${#prefix[@]} -gt 0 ]; then
    sudo -n true 2>/dev/null || return 1
  fi
  "${prefix[@]}" "$@"
}

# The file system the folder is (or would be) on.
existing=$dir
while [ ! -e "$existing" ]; do existing=$(dirname "$existing"); done
case "$(stat -f -c %T "$existing")" in
  nfs* | cifs | smb*) network=true ;;
  *) network=false ;;
esac

if [ ! -e "$dir" ]; then
  if $network; then
    echo "The backup folder $dir does not exist on the network share." >&2
    echo "Create it on the NAS, owned by user and group 999, then deploy again." >&2
    exit 1
  fi
  echo "    creating the backup folder $dir for the backup services"
  { as_root mkdir -p "$dir" && as_root chown "$uid:$uid" "$dir" && as_root chmod 750 "$dir"; } ||
    fix_by_hand
  exit 0
fi

[ -d "$dir" ] || { echo "$dir is not a folder." >&2; exit 1; }
read -r owner group mode < <(stat -c '%u %g %a' "$dir")
if [ "$owner" = "$uid" ]; then
  exit 0
fi

if $network; then
  # Writable by 999 without owning it: through its group or for everyone.
  if { [ "$group" = "$uid" ] && (( (8#$mode & 8#020) != 0 )); } || (( (8#$mode & 8#002) != 0 )); then
    exit 0
  fi
  if $dry_run; then
    echo "    [dry-run] would test writing to it as user $uid (docker run alpine:3.24)"
    exit 0
  fi
  echo "    testing that user $uid can write to the backup folder $dir (network share)"
  if docker run --rm --user "$uid:$uid" -v "$(cd "$dir" && pwd -P):/check" alpine:3.24 \
    sh -c 'f=/check/.write-test.$$ && touch "$f" && rm -f "$f"'; then
    exit 0
  fi
  echo "The backup folder $dir is on a network share (owner $owner, mode $mode)," >&2
  echo "  and user 999 cannot write to it, so every backup would fail. Fix it on" >&2
  echo "  the NAS: owner 999:999, as in docs/backup-and-restore.md, 1.2. Then" >&2
  echo "  deploy again." >&2
  exit 1
fi

echo "    giving the backup folder $dir to the backup services (user 999)"
{ as_root chown "$uid:$uid" "$dir" && as_root chmod 750 "$dir"; } || fix_by_hand
