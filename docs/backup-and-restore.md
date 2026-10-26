# Database backup and restore

Bookings, guests and finances live only in the PostgreSQL database, and the
receipts on transactions and the documents on recurring costs in the
`receipts` volume. Nothing else can rebuild
them, so this is the procedure that keeps them safe.

| What           | How                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Backups        | `pg_dump` of `vacation_home`, compressed SQL, by the `backup` service in `docker-compose.yml`                         |
| Tool           | [postgres-backup-local](https://github.com/prodrigestivill/docker-postgres-backup-local)                              |
| When           | `BACKUP_SCHEDULE`, default daily (`@daily`, midnight in `BACKUP_TZ`), plus on every start                             |
| Where          | `BACKUP_HOST_DIR` on the Docker host, which must be an NFS mount from another machine                                 |
| Kept           | `BACKUP_KEEP_DAYS` daily (7), `BACKUP_KEEP_WEEKS` weekly (4), `BACKUP_KEEP_MONTHS` monthly (6)                        |
| Alert if stale | A push monitor (Uptime Kuma or Healthchecks) that alerts after 48 hours without a backup                              |
| Restore        | `scripts/backup/restore.sh`, rehearsed into a scratch database                                                        |
| Receipts       | Mirrored daily to `BACKUP_HOST_DIR/receipts` by `receipts-backup`; restored with `scripts/backup/receipts-restore.sh` |

All settings are in `.env` next to `docker-compose.yml`; `.env.example` lists
them with their defaults.

Every command below runs on the **Docker host**: the Debian VM or LXC where
the app's `docker-compose.yml` lives, unless it says otherwise. "The app
folder" means the folder that contains `docker-compose.yml`.

## Contents

1. [One-time setup](#1-one-time-setup)
2. [The 48-hour alert](#2-the-48-hour-alert)
3. [Rehearse a restore](#3-rehearse-a-restore) (do this after setup, then every 3 months)
4. [Restore for real](#4-restore-for-real)
5. [After a restore: erase guests again](#5-after-a-restore-erase-guests-again)
6. [Erased guests and backups (DSGVO)](#6-erased-guests-and-backups-dsgvo)
7. [Files volume: receipts and listing photos](#7-files-volume-receipts-and-listing-photos)

## 1. One-time setup

### 1.1 Off-host storage: an NFS share

A backup on the same machine as the database dies with it. The backups go to
a folder on **another** machine, shared over NFS: a NAS, or another Proxmox
node. NFS rather than SMB/Windows shares: the backup tool needs hard links,
which SMB does not support.

**On the machine that stores the backups** (a NAS: create an NFS share in
its web interface instead, and skip to 1.2). On a Debian machine:

```bash
sudo apt install nfs-kernel-server                    # install the NFS server
sudo mkdir -p /srv/backups/vacation-home              # the folder that will hold the backups
sudo chown 999:999 /srv/backups/vacation-home         # owned by user id 999, the user the backup container runs as
echo '/srv/backups/vacation-home 192.168.178.XX(rw,sync,no_subtree_check)' | sudo tee -a /etc/exports
                                                      # share it with the Docker host only; replace XX with its address
sudo exportfs -ra                                     # apply the new share
```

Backups contain guests' personal data. Share the folder with the Docker host's
address only, as above, never with the whole network.

### 1.2 Mount the share on the Docker host

```bash
sudo apt install nfs-common                           # the NFS client
sudo mkdir -p /mnt/backups/vacation-home              # where the share appears on this machine
echo '192.168.178.YY:/srv/backups/vacation-home /mnt/backups/vacation-home nfs defaults,_netdev,nofail 0 0' | sudo tee -a /etc/fstab
                                                      # mount it at every boot; YY = the storage machine's address
                                                      # (_netdev: wait for the network; nofail: boot even if it is down)
sudo systemctl daemon-reload                          # let systemd pick up the changed /etc/fstab
sudo mount /mnt/backups/vacation-home                 # mount it now
df -h /mnt/backups/vacation-home                      # check: the "Filesystem" column should show the storage machine
```

On a NAS share, run this once as well, so the backup container may write
there (skip it if you ran the `chown` in 1.1):

```bash
sudo chown 999:999 /mnt/backups/vacation-home        # owned by the backup container's user (id 999)
```

### 1.3 Configure and start the backups

In the app folder:

```bash
nano .env                                             # open the settings in a text editor
```

Add (or change) these lines, then save with Ctrl+O, Enter, and leave with
Ctrl+X:

```bash
BACKUP_HOST_DIR="/mnt/backups/vacation-home"
BACKUP_TZ="Europe/Berlin"
```

The other `BACKUP_` settings can stay at their defaults for now; the alert
URLs come in step 2.

```bash
docker compose --profile backup up -d backup receipts-backup
                                                      # start the database backups and the receipts mirror; both run once right away
docker compose logs backup                            # show what it did; look for "SQL backup created successfully"
ls -l /mnt/backups/vacation-home/last/                # the first backup file should be listed, a few kB or more in size
docker compose logs receipts-backup                   # look for "Receipts: ... copied, ... 0 broken"
docker compose ps backup receipts-backup              # both "(healthy)" once their first run has succeeded
```

From now on it backs up every day and removes old backups by itself.

If the log shows `Permission denied` (or the services restart over and over),
the folder does not belong to user id 999 yet. Docker creates a missing
folder as root, which the backup services cannot write to. Fix it once, then
restart them:

```bash
sudo mkdir -p /mnt/backups/vacation-home              # the folder, if it is missing (use your BACKUP_HOST_DIR)
sudo chown 999:999 /mnt/backups/vacation-home         # give it to the backup services' user and group (id 999)
sudo chmod 750 /mnt/backups/vacation-home             # only they (and root) may read the backups
docker compose restart backup receipts-backup         # start both services again
```

On the production server, `scripts/deploy/deploy.sh` does this for a local
folder by itself (with `sudo`, if it may run without a password; otherwise it
stops and prints these commands). For a network share it only checks, since
ownership is set on the NAS: it writes a test file there as user 999 and
stops the deploy if that fails.

## 2. The 48-hour alert

A backup that silently stopped is only noticed when it is needed. So every
successful backup sends a heartbeat to a monitor, and the monitor alerts when
the heartbeats stop: by default after 48 hours, which allows one missed daily
run before it fires. A failed backup is reported straight away as well.

Both of these are open source and run well in an LXC on Proxmox. Use the one
you already have.

**Uptime Kuma**

1. _Add New Monitor_, type **Push**. Name it "vacation-home backup".
2. _Heartbeat Interval_: **172800** seconds (48 hours). _Retries_: 0.
3. Save, then copy the **Push URL** it shows, without the `?status=up&msg=OK&ping=` part.
4. In `.env`:

   ```bash
   BACKUP_HEARTBEAT_URL="http://kuma.lan:3001/api/push/AbCdEf123"
   BACKUP_FAILURE_URL="http://kuma.lan:3001/api/push/AbCdEf123?status=down&msg=backup%20failed"
   ```

**Healthchecks**

1. _Add Check_. _Period_: **1 day**, _Grace time_: **1 day**: an alert after
   48 hours without a ping.
2. Copy its ping URL.
3. In `.env`:

   ```bash
   BACKUP_HEARTBEAT_URL="http://healthchecks.lan/ping/1234-abcd"
   BACKUP_FAILURE_URL="http://healthchecks.lan/ping/1234-abcd/fail"
   ```

Then, in the app folder:

```bash
docker compose --profile backup up -d backup          # recreate the service with the new settings; it backs up at once
docker compose logs backup | grep -i webhook          # should show "Execute post-backup webhook call to ..."
```

The monitor should now show the check as up. The alert threshold lives in
the monitor (172800 seconds, or period + grace). To change it, change it
there. If you back up more often than daily (`BACKUP_SCHEDULE`), you may
shorten it.

Docker keeps a second, local eye on both services. `docker compose ps` shows
`backup` as **unhealthy** when its newest successful dump is more than 26
hours old, and `receipts-backup` when its last run failed or is more than 26
hours ago. The reason is in the log:

```bash
docker compose ps backup receipts-backup              # "(healthy)" or "(unhealthy)" after each name
docker compose logs --tail 50 receipts-backup         # the reason, after "Receipts mirror FAILED:"
```

If you back up less often than daily, set `BACKUP_HEALTH_MAX_AGE_MIN` in
`.env` to a little over the interval, in minutes (1560 is 26 hours).

## 3. Rehearse a restore

A backup that has never been restored is a hope, not a backup. Rehearse
after the first setup, then every 3 months and after every major upgrade.
The rehearsal restores into a **separate** database,
`vacation_home_restore_test`, and does not touch the live data or stop the
app.

In the app folder:

```bash
ls -l /mnt/backups/vacation-home/daily/               # list the daily backups; pick one, e.g. the latest
scripts/backup/restore.sh --dry-run /mnt/backups/vacation-home/daily/vacation_home-latest.sql.gz
                                                      # check the file and show what would be done, changing nothing
scripts/backup/restore.sh /mnt/backups/vacation-home/daily/vacation_home-latest.sql.gz
                                                      # restore it into the scratch database
```

The script ends by counting what it restored, for example:

```
 properties | guests | bookings |      last_migration
------------+--------+----------+----------------------------
          2 |     41 |      187 | 2026-10-02 18:03:11.52+00
```

Check that the numbers look plausible: about as many bookings as the app
shows. Then remove the scratch database:

```bash
docker compose exec db dropdb -U vacation vacation_home_restore_test
                                                      # delete the rehearsal copy; it holds personal data too
```

Running the script again is always safe: it starts with a fresh scratch
database each time.

Check the receipts mirror too; this only reads:

```bash
scripts/backup/receipts-restore.sh --dry-run /mnt/backups/vacation-home/receipts
                                                      # checks every mirrored receipt against its name; lists what a restore would copy
```

It should end with `0 broken`. On a working system it has nothing to copy:
the live volume already holds every receipt.

**Record every rehearsal here**, in this file, with a merge request. The
issue (GitLab #95) is only done once the first line is filled in.

| Date | Backup file | Properties / guests / bookings | Took | Done by | Notes |
| ---- | ----------- | ------------------------------ | ---- | ------- | ----- |
|      |             |                                |      |         |       |

## 4. Restore for real

Use this when the live data is damaged or lost, for example after a bad
manual change or a broken disk. Restoring replaces **everything** in the live
database with the backup. Anything entered after that backup is lost, so pick
the newest backup from before the problem.

### 4.1 The Docker host still works

In the app folder:

```bash
ls -l /mnt/backups/vacation-home/last/ /mnt/backups/vacation-home/daily/
                                                      # list the backups with their times; pick the newest good one
scripts/backup/restore.sh --dry-run --target vacation_home /mnt/backups/vacation-home/daily/vacation_home-20261007.sql.gz
                                                      # rehearse it: checks the file, changes nothing
scripts/backup/restore.sh --target vacation_home /mnt/backups/vacation-home/daily/vacation_home-20261007.sql.gz
                                                      # the real restore; asks you to type the database name first
```

The script:

1. checks that the backup file is complete;
2. saves the list of guests erased so far (see step 5). If it cannot read
   them, it stops here, before changing anything, and shows the database's
   error;
3. restores the backup into a separate staging database,
   `vacation_home_restoring`, and counts what it restored. The app keeps
   running and the live database is not touched yet;
4. lists any erased guests the backup brought back;
5. stops the app, renames the current database to
   `vacation_home_pre_restore_<date>_<time>` (kept, not deleted) and gives
   the restored one its name;
6. starts the app again, which brings the database structure up to date if
   the backup is older than the app.

So a damaged backup never costs you the current data: if the restore fails
in step 3, the script says the live database was not touched. Fix what it
reports and run the same command again; it starts over cleanly. If anything
fails later, the message says exactly what to do. To get the app running
again in any case:

```bash
docker compose start app                              # start the app with whatever is in the database now
```

Then open the app in the browser and check that recent bookings are there.

Then put back any receipts that are missing from the volume:

```bash
scripts/backup/receipts-restore.sh /mnt/backups/vacation-home/receipts
                                                      # copies receipts the volume lacks; deletes nothing, safe to repeat
```

**Do step 5 now** if the script listed any guests.

When the restored app works, **drop the kept copy**. It still holds the data
from before the restore, including guests erased since the backup, so it must
not linger. The script prints the exact command at the end, for example:

```bash
docker compose exec db dropdb -U vacation vacation_home_pre_restore_20261008_194002
                                                      # delete the copy of the old data; use the name the script printed
```

If the restore turned out wrong instead, the kept copy is your way back. Stop
the app and swap the names back (ask for help with this one).

### 4.2 The Docker host is gone

1. Create a new Debian 12 VM or LXC on Proxmox, with Docker installed.
2. Clone the app onto it and set up `.env` as before. Keep a copy of `.env`
   somewhere safe besides the VM, such as a password manager.
3. Mount the backup share: step 1.2.
4. In the app folder:

   ```bash
   docker compose up -d db                            # start only the database (empty for now)
   scripts/backup/restore.sh --yes --without-erasure-check --target vacation_home /mnt/backups/vacation-home/daily/vacation_home-latest.sql.gz
                                                      # restore the newest backup into it; the empty database has no erasures to read
   docker compose up -d                               # start the app (and create the empty receipts volume)
   scripts/backup/receipts-restore.sh /mnt/backups/vacation-home/receipts
                                                      # copy the receipts back from the mirror
   docker compose --profile backup up -d backup receipts-backup
                                                      # and the backups again
   ```

On a new machine there is no list of erased guests to read: it was in the
lost database. Without `--without-erasure-check` the script would stop there.
With it, it warns and goes ahead. Do step 5 by hand.

## 5. After a restore: erase guests again

Erasing a guest (DSGVO, GitLab #100) changes the database and records that
it happened in the same database. A backup from **before** an erasure still
has that guest's data, and restoring it brings the guest back. The audit
record of the erasure disappears with it. Those guests must be erased again
**right after the restore**, before anyone uses the app.

- **Restored over a working database** (4.1): the script saved the erased
  guests' ids before restoring. If any of them are back, it writes their ids
  to `backups-restore/erase-again-<date>_<time>.txt` in the app folder and
  ends with "ERASE THESE GUESTS AGAIN NOW" and the command to run. The full
  list of erasures on record is saved beside it as `erased-guests-...txt`.
  The files hold ids only, no personal data.
- **The database was lost** (4.2): the erasures since the backup can only
  come from your own records. Erasure
  requests should therefore also be noted outside the app, for example in
  the GDPR request log you keep anyway.

To erase them again, run the command the script printed, in the app folder
on the Docker host. It runs inside the app container, which the script has
just started again:

```bash
docker compose exec app npm run guests:repurge -- backups-restore/erase-again-20261008_194002.txt
                                                      # erase every guest listed in the file again; use the file name the script printed
```

On the production server ([deployment.md](deployment.md)) the app image has
no npm scripts; the command runs in the tools image instead, and the script
prints that form:

```bash
docker compose run --rm -v "$PWD/backups-restore:/app/backups-restore:ro" migrate npm run guests:repurge -- backups-restore/erase-again-20261008_194002.txt
                                                      # the same, in the tools image, with the saved ids made available to it
```

It erases each guest exactly as the app's erase action does, and prints
counts only, no names:

```text
Guests in backups-restore/erase-again-20261008_194002.txt: 3
  erased again:    3
  already erased:  0
  not found:       0 (not in this database; nothing to erase)
```

- **erased again**: the restore had brought them back, and they are erased
  now. Their bookings stay, as with any erasure.
- **already erased**: nothing to do. Running the command a second time shows
  every guest here, so repeating it is harmless.
- **not found**: the guest is not in the restored database at all (for
  example, created after the backup was taken), so there is nothing to erase.

For the lost-database case (4.2), write the ids from your own records into a
file in `backups-restore/`, one per line, and run the same command with that
file.

## 6. Erased guests and backups (DSGVO)

When a guest is erased, their data disappears from the live database at
once, but **not from backups taken before that**. Backups are not edited
after the fact: a backup that is changed afterwards can no longer be trusted
for a restore. Instead:

- **The data ages out with the retention.** The oldest backup is a monthly
  one, kept for `BACKUP_KEEP_MONTHS` × 31 days. With the default of 6, an
  erased guest's data is gone from every backup **at most about 6 months
  (186 days)** after the erasure. Lowering `BACKUP_KEEP_MONTHS` shortens
  that, and also how far back you can restore.
- **Until then the backups are only used for restoring**, and every restore
  re-applies the erasures (step 5), so erased data never returns to use.
- **The backups are protected like the live data**: on a share that only
  the Docker host can reach (1.1), on the LAN only.

Tell a guest who asks for erasure about this period. It also belongs in the
records of processing (Verzeichnis von Verarbeitungstätigkeiten) under
"deletion periods".

## Not covered here

- **Proxmox VM backups** (`vzdump`, Proxmox Backup Server) are a good
  addition for getting the whole machine back quickly, but they do not
  replace this. A snapshot of a running VM holds the database as if the power
  had been cut (PostgreSQL usually recovers from that, but it is not a
  clean dump), and it is restored as a whole machine, not per database.

## 7. Files volume: receipts and listing photos

Receipts on transactions, the documents on recurring costs (GitLab #130,
stored exactly like receipts) and the photos of the public listings (GitLab
#106) are files in one volume, still called `receipts` so existing
deployments keep it. Each file is named by its SHA-256, so it never changes
once written, and one file can serve both a receipt and a photo. Photos are
stored only as the app's own resized WebP copies, without any metadata. The
backup and restore below cover both kinds alike. The `receipts-backup`
service (`scripts/backup/receipts-mirror.sh`) copies new ones to
`BACKUP_HOST_DIR/receipts/files` once a day, at its start and then every 24
hours, checking each copy against its name.

- **Deleted receipts and photos** (or those of a deleted transaction) stay in the mirror
  for `BACKUP_RECEIPTS_KEEP_DAYS` (186 by default, like the monthly dumps), so
  an older database backup still has its receipts. Then they go.
- **A missing or empty volume is not a deletion.** If the receipts folder is
  missing or empty while the mirror holds files, the run fails and marks
  nothing as gone. A run that would newly mark more than a tenth of the
  mirror (and more than 10 files) as gone fails the same way. Either one
  makes `receipts-backup` unhealthy (see step 2). If many files really were
  deleted at once, for example a property with all its photos, let one run
  through:

  ```bash
  docker compose --profile backup run --rm -e RECEIPTS_ALLOW_GONE=1 receipts-backup /opt/backup/receipts-mirror.sh
                                                      # one mirror run that may mark any number of files as gone; they still stay 186 days
  ```

- **A restore** (`scripts/backup/receipts-restore.sh`) only adds files the
  volume lacks and deletes nothing. Files the restored database no longer
  lists are removed by the app's daily cleanup, which keeps every file a
  receipt **or** a photo still points to.
- **Guest erasure** does not touch receipts. They are accounting records:
  German tax law requires keeping them 8 years (§147 AO), which the DSGVO
  allows for (Art. 17(3)(b)). The app never deletes receipts by age; do that
  by hand once the 8 years are over.
