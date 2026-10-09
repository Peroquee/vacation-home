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
9. [First start](#9-first-start)
10. [Automatic deploys from GitLab](#10-automatic-deploys-from-gitlab)
11. [Rolling back](#11-rolling-back)
12. [Day to day](#12-day-to-day)

## 1. Choose how you will reach the app

Signing in uses Google, and Google only sends people back to an app at an
address it accepts. It accepts two kinds:

- **an https address on a real domain name**, such as
  `https://vacation.example.com`. It does not accept `.lan`, `.local`, a bare
  IP address, or plain http;
- **`http://localhost`**, the computer you are sitting at.

So there are two ways to run the app on your LAN:

|                   | Option A: your own domain                                                                           | Option B: SSH tunnel                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| You need          | a domain name you own, with its DNS at Cloudflare (or another provider Caddy supports)              | nothing extra                                                     |
| You open          | `https://vacation.example.com` on any device on the LAN                                             | `http://localhost:3000`, after starting a tunnel on that computer |
| Phones            | work like any other device                                                                          | impractical                                                       |
| Internet exposure | none: the certificate is proven through a DNS record (DNS-01), and the name points to a LAN address | none                                                              |

**Use option A if you have a domain**, or are willing to buy one (a few euros
a year). Option B works without one, but each computer needs the tunnel
running, and phones are out.

Either way, the app stays on your LAN, and Google Calendar sync still works:
the app polls Google every few minutes. Instant updates from Google (push
notifications) would need the app reachable from the internet, which this
setup deliberately avoids; see [Google push notifications](#google-push-notifications).

## 2. Create the server

In the Proxmox web interface, create a VM for Debian 12 ("bookworm"):

- **CPU** 2 cores, **memory** 4 GB, **disk** 32 GB. Building the app needs
  the memory; running it needs much less.
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
(and that GitLab logs in as for automatic deploys, step 10):

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
  `http://localhost:3000` for option B.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: from step 6.
- `NEXT_PUBLIC_APP_LOCALE`: `de-DE` for German number and date formats.
- `DATABASE_URL` can stay as it is: the server's settings override it.

For option A also set `APP_DOMAIN`, `ACME_EMAIL`, `CLOUDFLARE_API_TOKEN`
(step 7) and `TRUST_PROXY_HEADERS="true"`. For option B, set
`COMPOSE_PROFILES="backup"` (no `https`).

## 6. Google sign-in

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project (or reuse one).
2. **APIs & Services → Library**: enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: user type "External",
   publishing status "Testing", and add the allowed Google accounts as test
   users.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**, with these **Authorized redirect URIs** (use
   your `APP_URL`):
   - `<APP_URL>/api/auth/callback/google`
   - `<APP_URL>/api/google/callback`

   For option B that is `http://localhost:3000/api/auth/callback/google`
   and `http://localhost:3000/api/google/callback`.

5. Copy the client ID and secret into `.env` (`AUTH_GOOGLE_ID`,
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

Caddy starts with everything else in step 9. The first certificate takes up
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

## 9. First start

As `deploy`, in `/opt/vacation-home`:

```bash
scripts/deploy/deploy.sh --dry-run                            # shows what a deploy would do, changing nothing
scripts/deploy/deploy.sh                                      # builds the app (several minutes the first time), sets up the database, starts it all
docker compose ps                                             # lists what runs: db, app, and caddy/backup if chosen; all "Up"
curl -fsS http://127.0.0.1:3000/api/ready                     # check: prints {"status":"ready"}
```

Open the app (`https://vacation.example.com`, or `http://localhost:3000`
through the tunnel) and sign in with an allowed Google account.

Then set up the backups' storage and alerting: see
[backup-and-restore.md](backup-and-restore.md), which works the same here.
With `COMPOSE_FILE` set in `.env`, its `docker compose` commands apply to
this setup.

## 10. Automatic deploys from GitLab

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

## 11. Rolling back

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

## 12. Day to day

```bash
docker compose ps                                             # what runs, and whether it is healthy
docker compose logs --tail 100 app                            # the app's latest log lines
docker compose logs --tail 100 caddy                          # Caddy's, e.g. certificate trouble
docker compose restart app                                    # restart the app
sudo apt-get update && sudo apt-get upgrade -y                # Debian's security updates, now and then
```

After restoring a backup, erase again the guests the restore brought back.
The restore script prints the exact command for this setup.

### Google push notifications

Inbound calendar changes arrive by polling, every
`GOOGLE_CALENDAR_POLL_SECONDS` (five minutes by default). Instant push
notifications would need Google to reach `<APP_URL>/api/google/webhook` from
the internet over https. This setup keeps the app off the internet, so leave
`GOOGLE_WEBHOOK_URL` empty. If you ever want it, expose only that one path
(for example through a Cloudflare Tunnel) and set `GOOGLE_WEBHOOK_URL` to
its public address.

### Versions

The pinned versions (Node, PostgreSQL, Caddy and its DNS module) are at the
top of `Dockerfile`, `docker/caddy/Dockerfile` and `compose.prod.yml`. Change
them in the code, through a merge request, so the next deploy picks them up.
