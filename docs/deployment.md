# Running the app on your own server

This sets the app up on a Debian 12 virtual machine on your Proxmox server,
reachable from your home network (LAN) only. Nothing is opened to the
internet.

Every command below has a comment (after `#`) saying what it does. Commands
run **on the server** unless a step says otherwise. Copy them one at a time.

## Contents

1. [Choose how you will reach the app](#1-choose-how-you-will-reach-the-app)
2. [Create the server](#2-create-the-server)
3. [Install Docker](#3-install-docker)
4. [Get the app](#4-get-the-app)
5. [Settings (.env)](#5-settings-env)
6. [Google sign-in](#6-google-sign-in)
7. [Option A: https on your own domain](#7-option-a-https-on-your-own-domain)
8. [Option B: no domain, through an SSH tunnel](#8-option-b-no-domain-through-an-ssh-tunnel)
9. [Option C: Cloudflare Tunnel (no public IP)](#9-option-c-cloudflare-tunnel-no-public-ip)
10. [First start](#10-first-start)
11. [Automatic deploys from GitLab](#11-automatic-deploys-from-gitlab)
12. [Rolling back](#12-rolling-back)
13. [Day to day](#13-day-to-day)

## 1. Choose how you will reach the app

Signing in uses Google, and Google only sends people back to an app at an
address it accepts. It accepts two kinds:

- **an https address on a real domain name**, such as
  `https://vacation.example.com`. It does not accept `.lan`, `.local`, a bare
  IP address, or plain http;
- **`http://localhost`**, the computer you are sitting at.

So there are two ways to run the app on your LAN, and a third to put it on
the internet:

|                   | Option A: your own domain                                                                           | Option B: SSH tunnel                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| You need          | a domain name you own, with its DNS at Cloudflare (or another provider Caddy supports)              | nothing extra                                                     |
| You open          | `https://vacation.example.com` on any device on the LAN                                             | `http://localhost:3000`, after starting a tunnel on that computer |
| Phones            | work like any other device                                                                          | impractical                                                       |
| Internet exposure | none: the certificate is proven through a DNS record (DNS-01), and the name points to a LAN address | none                                                              |

**Use option A if you have a domain**, or are willing to buy one (a few euros
a year). Option B works without one, but each computer needs the tunnel
running, and phones are out.

**Option C puts the app on the internet** - needed for the public booking
site, where guests find the home and send requests - without a public IP
address or an open port: a Cloudflare Tunnel, which the server opens to
Cloudflare from the inside. It works behind DS-Lite and other internet
connections without a public IPv4 address. See
[Option C](#9-option-c-cloudflare-tunnel-no-public-ip).

With A or B, the app stays on your LAN, and Google Calendar sync still works:
the app polls Google every few minutes. Instant updates from Google (push
notifications) would need the app reachable from the internet, which this
setup deliberately avoids; see [Google push notifications](#google-push-notifications).

## 2. Create the server

In the Proxmox web interface, create a VM for Debian 12 ("bookworm"):

- **CPU** 2 cores, **memory** 4 GB, **disk** 32 GB. Building the app needs
  the memory; running it needs much less.
- **What fills the disk**, roughly: Debian and Docker 3 GB; the app's last
  five builds 1.5 to 2.5 GB (they share most layers) and the tools image's
  last two about 1 GB; Docker's build cache, capped at 4 GB by every deploy
  (`DEPLOY_BUILD_CACHE_MAX` in `.env`; without a cap it grew to 15 GB in two
  days of frequent deploys); the database well under 1 GB for years of
  bookings; receipts as uploaded, about 1 to 3 MB per photo, so a few
  hundred receipts a year add under 1 GB; listing photos about 0.5 MB each in
  their three stored sizes. That is 10 to 12 GB in steady use, at most about
  13 GB, which leaves 32 GB plenty of room. To see it on the server:

  ```bash
  df -h /                                    # free space on the disk
  docker system df                           # what images, volumes and the build cache take
  ```

- Install Debian 12 from its netinst ISO, with the "SSH server" and
  "standard system utilities" software selections, and no desktop.
- Give it a fixed address on your LAN, for example 192.168.178.50: in the
  installer, or as a fixed DHCP lease in your router (Fritz!Box: Heimnetz →
  Netzwerk → the device → "Diesem Netzwerkgerät immer die gleiche IPv4-Adresse
  zuweisen").

Then, from your own computer, log in to the server over SSH:

```bash
ssh you@192.168.178.50                       # log in to the server (your user and its address)
```

## 3. Install Docker

These are Docker's own installation steps for Debian:

```bash
sudo apt-get update                                           # refresh the list of available packages
sudo apt-get install -y ca-certificates curl git              # tools needed below: certificates, a downloader, git
sudo install -m 0755 -d /etc/apt/keyrings                     # create the folder for package signing keys
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
                                                              # download Docker's signing key
sudo chmod a+r /etc/apt/keyrings/docker.asc                   # let the package manager read the key
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null # add Docker's package source for this Debian version
sudo apt-get update                                           # refresh again, now including Docker's packages
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
                                                              # install Docker and Compose
sudo docker run --rm hello-world                              # check: prints "Hello from Docker!"
```

## 4. Get the app

The app lives in `/opt/vacation-home`, owned by a user `deploy` that runs it
(and that GitLab logs in as for automatic deploys, step 11):

```bash
sudo adduser --disabled-password --gecos "" deploy            # create the user "deploy" (no password: SSH keys only)
sudo usermod -aG docker deploy                                # let "deploy" use Docker
sudo mkdir -p /opt/vacation-home                              # create the app's folder
sudo chown deploy:deploy /opt/vacation-home                   # and give it to "deploy"
sudo -iu deploy                                               # continue as "deploy" (exit returns to your user)
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519              # create a key the server uses to read the code from GitLab
cat ~/.ssh/id_ed25519.pub                                     # print the public key, to add in GitLab (next step)
```

In GitLab, open the project → **Settings → Repository → Deploy keys**, add
the printed key (read-only is enough). Then, still as `deploy`:

```bash
git clone git@192.168.178.194:web-projects/vacation-home.git /opt/vacation-home
                                                              # download the app (answer "yes" to trust GitLab's key)
cd /opt/vacation-home                                         # go into the app's folder; later commands run here
```

## 5. Settings (.env)

```bash
cp .env.example .env                                          # start from the documented template
chmod 600 .env                                                # only "deploy" may read it: it holds secrets
openssl rand -base64 32                                       # prints a random secret: use it for AUTH_SECRET
openssl rand -base64 24                                       # prints another: use it for POSTGRES_PASSWORD
openssl rand -base64 32                                       # and another: use it for TOKEN_ENCRYPTION_KEY
nano .env                                                     # edit the settings (save: Ctrl+O, Enter; leave: Ctrl+X)
```

In `.env`, set at least these. Each is explained in the file itself.

- At the bottom, remove the `#` in front of `COMPOSE_FILE`, `COMPOSE_PROFILES`
  and `POSTGRES_PASSWORD`, and set the password.
- `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`: the random values from above.
  Keep a copy of `.env` somewhere safe outside this server, such as your
  password manager: the backups cannot restore it.
- `AUTH_ALLOWED_EMAILS`: the Google accounts that may sign in.
- `APP_URL`: `https://vacation.example.com` for option A,
  `http://localhost:3000` for option B, `https://robbenplate.com` (your
  public hostname) for option C.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: from step 6.
- `DATABASE_URL` can stay as it is: the server's settings override it.

For option A also set `APP_DOMAIN`, `ACME_EMAIL`, `CLOUDFLARE_API_TOKEN`
(step 7) and `TRUST_PROXY_HEADERS="true"`. For option B, set
`COMPOSE_PROFILES="backup"` (no `https`). For option C, see step 9:
`COMPOSE_PROFILES="tunnel,backup"`, `TUNNEL_TOKEN` and
`TRUST_PROXY_HEADERS="cloudflare"`.

With the `backup` profile, the folder `BACKUP_HOST_DIR` must belong to user
999, the backup services' user. `scripts/deploy/deploy.sh` creates or fixes a
local folder (it uses `sudo`; if that would ask for a password, it stops and
prints the commands). To do it by hand, for the default `./backups`:

```bash
mkdir -p backups                                              # the folder next to the app, if missing
sudo chown 999:999 backups                                    # give it to the backup services' user
sudo chmod 750 backups                                        # only they (and root) may read it
```

### Email (optional)

The app emails guests at each step of a booking request (received,
reserved with what to pay, payment received, fully paid with the address)
and you about new requests, lapsed reservations and overdue balances. It
needs an SMTP account, for example your mail provider's. In `.env`:

- `SMTP_HOST`, `SMTP_PORT` (587 for STARTTLS, or 465 with
  `SMTP_SECURE="true"`), `SMTP_USER`, `SMTP_PASSWORD`: from your provider.
- `SMTP_FROM`: the sender guests see, such as
  `"Haus am See <stay@example.com>"`. Use an address your provider lets
  you send from, or the mails land in spam.
- `OWNER_EMAIL`: where your own notifications go. Guests' replies go
  there too.

Without these the app runs as before and sends nothing: the emails wait,
and go out once SMTP is set (anything older than 30 days is dropped
instead). **Settings → Emails** shows whether mail is set up, what is
waiting and what failed, and **Send now** sends at once. A mail server
that fails is tried again for a day, then the email is marked failed.

The app insists on an encrypted connection to the mail server.
`SMTP_REQUIRE_TLS="false"` turns that off: only for a mail server on your
own network that has no TLS.

## 6. Google sign-in

Follow [google-cloud-setup.md](google-cloud-setup.md): a Google Cloud
project, its consent screen, and an OAuth client whose redirect URIs use
your `APP_URL`:

- `<APP_URL>/api/auth/callback/google`
- `<APP_URL>/api/google/callback`

For option B that is `http://localhost:3000/api/auth/callback/google` and
`http://localhost:3000/api/google/callback`; for option C
`https://robbenplate.com/api/auth/callback/google` and
`https://robbenplate.com/api/google/callback`. Changing `APP_URL` later
means adding its two redirect URIs to the client first: Google refuses a
sign-in to an address it does not list. With calendar sync, publish the
app there (its step 4): in "Testing", Google ends the calendar access every
7 days.

Copy the client ID and secret into `.env` (`AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`).

## 7. Option A: https on your own domain

Caddy, a web server, sits in front of the app. It gets a free certificate
from Let's Encrypt by putting a temporary record into your domain's DNS
(the DNS-01 challenge), so Let's Encrypt never needs to reach your network,
and it renews the certificate by itself.

**The DNS provider's token.** These steps assume your domain's DNS is at
Cloudflare (free). In the Cloudflare dashboard: **My Profile → API Tokens →
Create Token → "Edit zone DNS"** template, limited to your domain's zone.
Put the token in `.env` as `CLOUDFLARE_API_TOKEN`. For another DNS provider,
see [Another DNS provider](#another-dns-provider) below.

**The name, pointing to your server.** `vacation.example.com` must resolve to
the server's LAN address (192.168.178.50 in these examples) for every device
on your LAN. Either:

- **at your DNS provider:** an `A` record `vacation` → `192.168.178.50`
  (Cloudflare: proxy status "DNS only", the grey cloud). It points to a
  private address, so it is useless from outside your network. A Fritz!Box
  blocks such answers by default (DNS rebind protection). Allow this one name
  under **Heimnetz → Netzwerk → Netzwerkeinstellungen → DNS-Rebind-Schutz →
  Hostnamen-Ausnahmen**: add `vacation.example.com`;
- **or in your LAN's own DNS**, if you run one (Pi-hole, AdGuard Home): a
  local DNS record with the same name and address.

Check it from your own computer:

```bash
nslookup vacation.example.com                                 # should answer 192.168.178.50
```

Caddy starts with everything else in step 10. The first certificate takes up
to a minute.

### Another DNS provider

Cloudflare is only the worked example: Caddy needs a plugin for whichever
provider hosts your domain's DNS, and there is one for most of them (Hetzner,
deSEC, Porkbun, IONOS, Route 53, …) at
[github.com/caddy-dns](https://github.com/caddy-dns). Each plugin's README
names its module path, its newest release and the `dns` line it expects. To
switch, change three places and rebuild Caddy:

1. **`docker/caddy/Dockerfile`**: set `DNS_MODULE` to the plugin, pinned to
   a release, e.g. `github.com/caddy-dns/<provider>@<version>`.
2. **`docker/caddy/Caddyfile`**: replace the line
   `dns cloudflare {env.CLOUDFLARE_API_TOKEN}` with the plugin's own, e.g.
   `dns <provider> {env.<PROVIDER>_API_TOKEN}`. Keep the `resolvers` line.
3. **`compose.prod.yml`** (service `caddy`, `environment`) and **`.env`**:
   replace `CLOUDFLARE_API_TOKEN` with the variable(s) the new `dns` line
   reads, and create the token at your provider with permission to edit
   that one zone's DNS records.

Then rebuild and restart only Caddy:

```bash
docker compose build caddy                                    # builds Caddy with the new plugin
docker compose up -d caddy                                    # restarts Caddy; it requests a certificate
docker compose logs -f caddy                                  # watch for "certificate obtained"; Ctrl+C to stop
```

If the logs show the challenge failing, the token usually lacks the right to
edit the zone's records, or the `dns` line's options do not match the
plugin's README.

## 8. Option B: no domain, through an SSH tunnel

The app listens on the server itself (`127.0.0.1:3000`), and an SSH tunnel
brings that port to your computer, where Google accepts
`http://localhost:3000`.

On **your computer**, each time you want to use the app:

```bash
ssh -N -L 3000:127.0.0.1:3000 deploy@192.168.178.50          # keep this running; it forwards localhost:3000 to the app
```

Then open `http://localhost:3000` in the browser. To stop, press Ctrl+C in
the tunnel's window.

On Windows, the same command works in PowerShell (OpenSSH is built in). You
need SSH access as `deploy`: add your computer's public key to
`/home/deploy/.ssh/authorized_keys` on the server.

## 9. Option C: Cloudflare Tunnel (no public IP)

For the public booking site the app must be reachable from the internet.
Many connections (DS-Lite, most cable and fibre lines) have no public IPv4
address, so nothing from outside can connect in. A **Cloudflare Tunnel**
turns this around: a small program, `cloudflared`, runs next to the app
(the `tunnel` service in `compose.prod.yml`) and connects **out** to
Cloudflare. Visitors open `https://robbenplate.com`; Cloudflare answers
with its own certificate and passes each request back through the tunnel
to the app. No port is opened on the router or the server, and Caddy
(option A) is not needed.

You need the domain's DNS at Cloudflare (the free plan is enough). At the
registrar (IONOS, for example), the domain's name servers are set to the
two Cloudflare shows when you add the domain.

**1. Create the tunnel.** In the Cloudflare dashboard, open **Zero Trust**
(on first use it asks for a team name; the free plan is fine) → **Networks
→ Tunnels → Create a tunnel** → type **Cloudflared** → name it, e.g.
`vacation-home` → save. The next page, "Install and run a connector",
shows commands with a long token after `--token`. Copy only that token;
you do not need to run the commands, `compose.prod.yml` does that.
(Cloudflare renames these menus now and then; the steps stay the same.)

**2. The public hostname.** On the same tunnel, tab **Public Hostname**
(also called "Published application routes") → **Add**:

- Subdomain: empty; Domain: `robbenplate.com`; Path: empty;
- Service: type `HTTP`, URL `app:3000` (the app's name on the Compose
  network, not `localhost`).

Cloudflare creates the matching DNS record itself (a proxied `CNAME` to
`<id>.cfargotunnel.com`). If the domain already has an `A` or `CNAME`
record for that name (the registrar's parking page, say), delete it first.
Under **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**.

**3. `.env`.** Settings for this option:

```bash
nano .env                                                     # edit the settings (save: Ctrl+O, Enter; leave: Ctrl+X)
```

In it, set (each comment line explains the line below it):

```dotenv
# The public address; sign-in and links use it.
APP_URL="https://robbenplate.com"
# The token from step 1. A secret: keep it out of chats and tickets.
TUNNEL_TOKEN="eyJh..."
# Rate limits count per visitor, from Cloudflare's CF-Connecting-IP.
TRUST_PROXY_HEADERS="cloudflare"
# Start the tunnel and the backups with the app ("https" is not needed: no Caddy).
COMPOSE_PROFILES="tunnel,backup"
```

Also add `https://robbenplate.com/api/auth/callback/google` and
`https://robbenplate.com/api/google/callback` to the Google OAuth client
(step 6) **before** changing `APP_URL`, or sign-in stops working. With the
app on the internet, Google push notifications can be turned on too: set
`GOOGLE_WEBHOOK_URL="https://robbenplate.com/api/google/webhook"` (see
[Google push notifications](#google-push-notifications)). `ICAL_PUBLIC_URL`
can stay empty: the feed links use `APP_URL`, which booking platforms can
now reach.

**4. Start it.**

```bash
scripts/deploy/deploy.sh                                      # restarts the app with the new settings and starts the tunnel
docker compose ps tunnel                                      # check: the tunnel service is "Up"
docker compose logs tunnel | grep -i "registered"             # check: lines like "Registered tunnel connection"
curl -fsS https://robbenplate.com/api/ready                   # check from anywhere: prints {"status":"ready"}
```

The tunnel's dashboard page then shows the connector as **Healthy**.

**Moving from a tailscale serve address.** If the app was served on your
tailnet before (e.g. `https://vacation.tail395dc6.ts.net`), it is now
reached at one address only, `APP_URL`: sign-in and the protection against
cross-site requests accept that one. Tailscale stays for SSH and
operations. On the server:

```bash
sudo tailscale serve status                                   # shows what is served on the tailnet, if anything
sudo tailscale serve reset                                    # stop serving the app on the tailnet; it would no longer sign in
```

Afterwards, the old `ts.net` redirect URIs can be removed from the Google
OAuth client.

**If the tunnel is down,** the public site and sign-in are unreachable;
there is deliberately no second way in. Over SSH (Tailscale or the LAN),
check the app itself, then the tunnel:

```bash
curl -fsS http://127.0.0.1:3000/api/ready                     # the app and its database: prints {"status":"ready"}
docker compose logs --tail 50 tunnel                          # the tunnel's recent messages (an invalid token, no connection)
docker compose restart tunnel                                 # reconnects to Cloudflare
```

Fixing the tunnel restores access. A new token (Cloudflare: the tunnel →
**Configure** → refresh the token) goes into `.env`, followed by
`docker compose up -d tunnel`.

### Optional: Cloudflare Access for the owner's pages

The tunnel makes **every** page reachable from the internet; the owner's
pages are protected by the Google sign-in and the allow-list
(`AUTH_ALLOWED_EMAILS`). For a second lock, Cloudflare Access can ask for
a one-time code by email (or a Google sign-in) before a request even
reaches the app. Docs only - decide later; nothing in the app depends on
it.

In **Zero Trust → Access → Applications**:

1. **Add an application → Self-hosted**, domain `robbenplate.com`, path
   empty, with a policy **Allow** → Include → **Emails**: your own
   addresses. This covers everything.
2. **Add another self-hosted application** for the paths that must stay
   open to everyone, with a policy **Bypass** → Include → **Everyone**.
   Add one domain entry per path: `robbenplate.com` with path `stay`,
   `api/public`, `api/ical`, `robots.txt`, `api/google/webhook`, and
   `_next` (the scripts and styles the public pages load). Access applies
   the most specific path, so these stay public.

Check it in a private browser window: `https://robbenplate.com/stay/<slug>`
opens without a code, `https://robbenplate.com/calendar` asks for one.
Booking platforms fetching the iCal feeds and Google's push notifications
keep working, as their paths are bypassed.

## 10. First start

As `deploy`, in `/opt/vacation-home`:

```bash
scripts/deploy/deploy.sh --dry-run                            # shows what a deploy would do, changing nothing
scripts/deploy/deploy.sh                                      # builds the app (several minutes the first time), sets up the database, starts it all
docker compose ps                                             # lists what runs: db, app, and caddy, backup and receipts-backup if chosen; all "Up"
curl -fsS http://127.0.0.1:3000/api/ready                     # check: prints {"status":"ready"}
```

Open the app (`https://vacation.example.com`, `http://localhost:3000`
through the SSH tunnel, or `https://robbenplate.com` with option C) and sign in with an allowed Google account.

Receipts on transactions are kept in the `receipts` volume, which the
`receipts-backup` service mirrors next to the database backups.

Then set up the backups' storage and alerting: see
[backup-and-restore.md](backup-and-restore.md), which works the same here.
With `COMPOSE_FILE` set in `.env`, its `docker compose` commands apply to
this setup.

## 11. Automatic deploys from GitLab

Once set up, every merge to `main` that passes all checks is deployed by
GitLab: its `deploy` job logs in to the server as `deploy` and runs
`scripts/deploy/deploy.sh`. The new version is built while the old one keeps
serving. The switch takes seconds, and Caddy holds requests for that moment
instead of failing them.

**Database migrations** run before the switch, while the old version still
serves. They therefore have to work with the old code too: add tables and
columns, never remove or rename one in the same release that stops using
it. The app's migrations so far only add.

Set it up:

1. A key for GitLab to log in with. On **your computer**:

   ```bash
   ssh-keygen -t ed25519 -N "" -f gitlab-deploy -C gitlab-deploy   # creates gitlab-deploy (private) and gitlab-deploy.pub
   ```

2. On the **server**, let that key log in as `deploy`:

   ```bash
   sudo -iu deploy                                            # act as "deploy"
   nano ~/.ssh/authorized_keys                                # paste the contents of gitlab-deploy.pub on a new line, save
   chmod 600 ~/.ssh/authorized_keys                           # SSH insists the file is private
   ssh-keyscan 192.168.178.50                                 # prints the server's host key lines, for step 3
   ```

3. In GitLab, the project → **Settings → CI/CD → Variables**, add
   (all "Protected"):
   - `DEPLOY_HOST`: `deploy@192.168.178.50`
   - `DEPLOY_SSH_KEY`: type **File**, the contents of `gitlab-deploy`
     (the private key)
   - `DEPLOY_KNOWN_HOSTS`: the lines `ssh-keyscan` printed
   - `DEPLOY_PATH` only if the app is not in `/opt/vacation-home`

From the next merge to `main` on, the pipeline ends with a `deploy` job. Its
log shows the deploy script's output.

## 12. Rolling back

The last five builds stay on the server. To go back to the version before
the last deploy, run the command the deploy printed at the end, or:

```bash
docker images vacation-home                                   # lists the kept builds by commit; "current" is the running one
scripts/deploy/deploy.sh --rollback 21d89b3                   # switch the app back to that commit's build
```

A rollback switches the code only, and leaves the database as it is. That's
fine when the newer release only added to the database (the rule in step
10). If it changed data in a way the old version can't handle, restore the
backup taken before the deploy instead: [backup-and-restore.md](backup-and-restore.md),
"Restore for real".

To stop automatic deploys while you investigate, delete or rename the
`DEPLOY_HOST` variable in GitLab.

## 13. Day to day

```bash
docker compose ps                                             # what runs, and whether it is healthy
docker compose logs --tail 100 app                            # the app's latest log lines
docker compose logs --tail 100 caddy                          # Caddy's, e.g. certificate trouble
docker compose restart app                                    # restart the app
sudo apt-get update && sudo apt-get upgrade -y                # Debian's security updates, now and then
scripts/perf/explain.sh                                       # once there is real data: checks whether the database needs more indexes
```

The last one only reads. It ends with "none" when the indexes cover the
app's reads; anything else it lists is worth an issue.

After restoring a backup, erase again the guests the restore brought back.
The restore script prints the exact command for this setup.

### Google push notifications

Inbound calendar changes arrive by polling, every
`GOOGLE_CALENDAR_POLL_SECONDS` (five minutes by default). Instant push
notifications would need Google to reach `<APP_URL>/api/google/webhook` from
the internet over https. Options A and B keep the app off the internet, so
leave `GOOGLE_WEBHOOK_URL` empty there. With option C the app is on the
internet: set `GOOGLE_WEBHOOK_URL` to `https://robbenplate.com/api/google/webhook`.

### Sharing availability with booking platforms

Importing Airbnb's or Booking.com's calendar (**Settings → Booking
platforms**) works on the LAN as it is: the server fetches their links. The
other direction, the app's own calendar link for them to import, only works
if the platforms can reach `/api/ical/...` from the internet. That is
optional; without it, import alone already turns their stays into blocks
here, and you keep the platforms' calendars up to date by hand.

If you want it, expose **only that path**, for example through a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
which needs no open port on your router. On the server:

```bash
docker run -d --name ical-tunnel --restart unless-stopped \
  --network vacation-home_default \
  cloudflare/cloudflared:2026.9.1 tunnel --no-autoupdate run --token <TOKEN>   # runs the tunnel next to the app
```

`<TOKEN>` comes from the Cloudflare dashboard (**Zero Trust → Networks →
Tunnels → Create a tunnel**). There, add a public hostname such as
`calendar.example.com` with **path** `^/api/ical/` and **service**
`http://app:3000`, so the tunnel passes on nothing else. (The network name is
`<folder name>_default`; `docker network ls` shows it.) Then set in `.env`:

```bash
ICAL_PUBLIC_URL="https://calendar.example.com"   # the links in Settings use this address
```

and restart the app (`docker compose up -d app`). The links are secret
tokens, rate-limited, and show only "Booked" and "Blocked" on the taken
dates: no names, no prices. **Make a new link** in Settings retires an old
one at once.

### Versions

The pinned versions (Node, PostgreSQL, Caddy and its DNS module) are at the
top of `Dockerfile`, `docker/caddy/Dockerfile` and `compose.prod.yml`. Change
them in the code, through a merge request, so the next deploy picks them up.
