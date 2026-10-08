# Vacation Rental Manager

Booking calendar, Google Calendar sync and finance tracking for a small number
of vacation rental properties.

**Stack:** Next.js (App Router) + TypeScript · PostgreSQL + Prisma ·
Tailwind + shadcn/ui · Auth.js (Google OAuth) · Recharts · Docker

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Compose v2 — enough on
  its own for the Docker workflow below.
- Node — the version in [`.nvmrc`](.nvmrc), only if you run the app on the
  host. With [fnm](https://github.com/Schniz/fnm) or nvm installed,
  `fnm use` / `nvm use` picks it up automatically.

No local PostgreSQL install is needed; Compose provides PostgreSQL 16.

## Getting started

### Everything in Docker

```bash
docker compose up
```

That starts PostgreSQL and the Next dev server on <http://localhost:3000>. A
clean checkout needs no `.env`: when the container finds no env file at all it
falls back to the bootable placeholders in `.env.example`. Otherwise Next loads
your `.env` / `.env.local` exactly as it does on the host, except that
`DATABASE_URL` is always pointed at the `db` service. The first start runs
`npm ci` inside the container, so it takes a while; later starts reuse the
installed dependencies until `package-lock.json` changes. Every start applies
pending migrations before the dev server comes up.

| Command                  | Does                                          |
| ------------------------ | --------------------------------------------- |
| `docker compose up`      | Start the stack (`-d` to run it detached)     |
| `docker compose down`    | Stop and remove the containers, keep the data |
| `docker compose down -v` | Also delete the volumes — wipes the database  |
| `docker compose logs -f` | Follow the logs                               |

The database lives in the named volume `db-data`, so it survives stopping,
restarting and recreating the containers; only `down -v` removes it.

### App on the host, database in Docker

```bash
npm install
cp .env.example .env    # then fill in the blanks
docker compose up -d db
npm run migrate:deploy
npm run dev
```

PostgreSQL is published on host port **5433**, not the default 5432, so it
cannot clash with a local install. `DATABASE_URL` in `.env.example` already
points there (`localhost:5433`); containers on the Compose network reach the
same server as `db:5432`.

Dependencies installed inside the container live in their own volume, never in
the host's `node_modules`, since native packages such as Next's SWC binary have
to match the operating system they run on. The container runs as the owner of
the checkout, so anything it writes into the working tree stays yours.

On macOS and Windows, Docker's bind-mount file access makes hot reload
noticeably slower than on the host — Next's own guidance is to develop on the
host there. The hybrid workflow above gives you the shared database without
that cost.

## Database

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma) and every
change to it ships as a migration under [`prisma/migrations`](prisma/migrations),
committed with the code that needs it.

```bash
# after editing the schema: write a migration, apply it, regenerate the client
npm run migrate:dev -- --name add-guest-email
```

`migrate:dev` is for development only — it may offer to reset the database when
it detects drift. Deployments and fresh databases use `migrate:deploy`, which
only applies committed migrations, in order, and never generates or resets.

The client is generated into `src/generated/prisma` (ignored by git) on every
`npm install`, so a fresh clone or CI job needs no extra step. After pulling a
schema change, `npm run db:generate` regenerates it without reinstalling.
Application code imports the shared instance from
[`src/lib/db.ts`](src/lib/db.ts), which survives hot reloads instead of opening
a new connection pool on each one. The Prisma CLI reads `.env` files through
Next's own loader, so it sees the same variables `npm run dev` does.

### Backups

The `backup` service in `docker-compose.yml` dumps the database daily to
off-host storage, keeps a rotating set and reports to a monitor that alerts
after 48 hours without a backup. It is off in development; start it with
`docker compose --profile backup up -d backup`. Setup, the restore procedure
(`scripts/backup/restore.sh`) and how erased guests age out of backups are in
[docs/backup-and-restore.md](docs/backup-and-restore.md).

## API

JSON route handlers under `src/app/api`. Errors always look like:

```json
{ "error": { "code": "validation_failed", "message": "…", "fields": { "name": ["is required"] } } }
```

`code` is one of `invalid_json` (400), `not_found` (404), `conflict` (409),
`validation_failed` (422) or `upstream_unavailable` (502, Google could not be
reached). Under `validation_failed`, `fields` has one list of
messages per invalid field, with problems that belong to no single field under
`_`. Money is always an integer number of minor units (cents).

### Properties

| Method and path                      | Does                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `GET /api/properties`                | Active properties by name; `?includeArchived=true` for all |
| `POST /api/properties`               | Create; `201` with a `Location` header                     |
| `GET /api/properties/:id`            | One property                                               |
| `PATCH /api/properties/:id`          | Update any subset of fields                                |
| `POST /api/properties/:id/archive`   | Archive: hidden from selectors, history kept               |
| `POST /api/properties/:id/unarchive` | Restore                                                    |
| `DELETE /api/properties/:id`         | Delete, only without history; `409` if it has bookings     |

Fields: `name`, `address` (optional), `timezone` (IANA, e.g. `Europe/Lisbon`),
`currency` (ISO 4217), `defaultNightlyRateMinor` and `defaultCleaningFeeMinor`
(default 0), and `color` (`#rrggbb`, default the brand teal). Responses add
`id`, `archived`, `archivedAt`, `createdAt` and `updatedAt`.

### Guests

| Method and path          | Does                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `GET /api/guests`        | Search: `?q=` matches part of the name or email, any case; `?limit=` ≤ 100 |
| `POST /api/guests`       | Create; `201`, or `200` with the existing guest if the email is known      |
| `GET /api/guests/:id`    | One guest                                                                  |
| `PATCH /api/guests/:id`  | Update; `409` if the email belongs to another guest                        |
| `DELETE /api/guests/:id` | Delete, only without bookings; `409` otherwise                             |

Fields: `name`, and optional `email` (stored lower-cased, so it is unique in
any case), `phone` and `notes`. Creating with a known email never makes a
duplicate, even when two requests race. That is what the booking form's
inline "new guest" relies on.

### Bookings

| Method and path                 | Does                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `GET /api/bookings`             | List, paginated, with filters (below)                             |
| `POST /api/bookings`            | Create; `409` if a confirmed booking's dates are taken            |
| `GET /api/bookings/:id`         | One booking, with its property and guest                          |
| `PATCH /api/bookings/:id`       | Update; new dates or confirming re-check availability             |
| `POST /api/bookings/:id/cancel` | Cancel: frees the dates, keeps the record. Bookings never delete. |

- **Dates**: `checkIn`/`checkOut` are `YYYY-MM-DD`; check-out is exclusive,
  so a guest may arrive on another's departure day. At most 365 nights.
- **Status**: `inquiry` (default; holds nothing), `confirmed` (holds the
  dates), `cancelled`. **Source**: `direct`, `airbnb`, `booking.com`, `other`.
- **Money**: rates default to the property's and the currency is copied
  from it. `totalAmountMinor` is nights × `nightlyRateMinor` +
  `cleaningFeeMinor`, kept up to date as dates and rates change, unless set by
  hand (`totalIsManual`); `PATCH` with `totalAmountMinor: null` hands it back
  to the calculation.
- **Conflicts**: a confirmed booking overlapping another confirmed booking or
  a block gets a `409` whose `error.conflicts` lists what is in the way
  (`kind`, `id`, `start`, `end`, and for blocks `reason`/`origin`). Moving a
  booking ignores its own old dates. PostgreSQL enforces the same rules, so
  they hold under concurrency.
- **List filters**: `propertyId`, `from`/`to` (stays overlapping that range),
  `status` and `source` (comma-separated), `q` (part of the guest's name or
  email), `page`, `pageSize` (≤ 100), `sort` (`checkIn`, `guest`, `property`,
  `status`, `source` or `total`; a leading `-` sorts descending). The
  response is `{ items, total, page, pageSize }`.

### Blocks

Dates a property cannot be booked that are not a booking: owner blocks
(maintenance, personal use) and events imported from Google Calendar.

| Method and path          | Does                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `GET /api/blocks`        | List, paginated, by start date (filters below)                    |
| `POST /api/blocks`       | Create a manual block; `409` if a confirmed booking is in the way |
| `GET /api/blocks/:id`    | One block                                                         |
| `PATCH /api/blocks/:id`  | Update `startDate`, `endDate` and/or `reason`                     |
| `DELETE /api/blocks/:id` | Delete a manual block (`204`); it is not an accounting record     |

- **Body**: `propertyId` (create only; it cannot change), `startDate`,
  `endDate` (`YYYY-MM-DD`, exclusive like a check-out, at most 730 nights),
  `reason` (optional, at most 200 characters; blank means none).
- **Conflicts**: a block may not share a night with a confirmed booking
  (inquiries and the check-out day are fine; other blocks are too). The
  `409` has `error.reason: "overlap"` and `error.conflicts` listing the
  bookings in the way (`kind`, `id`, `start`, `end`). PostgreSQL enforces the
  same rule.
- **Google blocks** (`origin: "google"`, `readOnly: true`) are changed only
  by the sync: `PATCH` and `DELETE` answer `409` with `error.reason: "google"`.
- **List filters**: `propertyId`, `from`/`to` (blocks overlapping that
  range), `page`, `pageSize` (≤ 500, default 100). The response is
  `{ items, total, page, pageSize }`.

### Categories

| Method and path                     | Does                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/categories`               | By type and name; `?type=income\|expense`, `?includeHidden=true`              |
| `POST /api/categories`              | Create a user category (`name`, `type`, `color`); `409` on a duplicate        |
| `PATCH /api/categories/:id`         | Rename, recolour, hide (`hidden: true`) or show. The type never changes.      |
| `DELETE /api/categories/:id`        | Delete an unused user category; `409` with `reason` otherwise                 |
| `POST /api/categories/:id/reassign` | `{ "to": "<id>" }`: move all its transactions there, in one step; `{ moved }` |

The default categories are **system categories**, created by the migration
in every database: booking income, cleaning fees and other income; cleaning,
maintenance, utilities, platform fees, supplies, insurance, taxes and other
expenses. You can rename, recolour and hide them, but the database refuses to
delete them (`reason: "system"`). The app finds them by their fixed
`systemKey`. A category used by transactions can't be deleted
(`reason: "in_use"`): move its transactions first with `reassign`, which
needs a different, visible category of the same type (`422` on `to` for the
other type, `409` for the same or a hidden one, `404` for an unknown one).

### Transactions

| Method and path                      | Does                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `GET /api/transactions`              | The ledger: filtered, paginated, sorted, with totals   |
| `POST /api/transactions`             | Record one; `201`                                      |
| `GET /api/transactions/:id`          | One transaction, with its category                     |
| `PATCH /api/transactions/:id`        | Update any subset of fields                            |
| `DELETE /api/transactions/:id`       | Delete one                                             |
| `POST /api/transactions/bulk-delete` | `{ "ids": [...] }`, up to 500, e.g. after a bad import |

- **Amounts** are positive integers of minor units (`amountMinor`), and the
  `type` (`income`/`expense`) gives the direction. They're in the
  property's currency, which a property can't change once it has
  transactions. No amount, total included, is ever a float.
- **References** are checked and reported per field. The category must have
  the transaction's type and must not be hidden (for a new choice), and a
  linked booking must belong to the same property. The database enforces the
  same rules with composite foreign keys. Changing the type needs a category
  of the new type in the same request; the property can't change.
- **List filters**: `propertyId`, `type`, `categoryId` (comma-separated),
  `from`/`to` (dates; `to` exclusive), `bookingId` or `linked=true|false`,
  `page`, `pageSize` (≤ 200), and `sort` (`date`, `-date`, `amount`,
  `-amount`; default `-date`). The response is `{ items, total, page,
pageSize, totals: [{ currency, incomeMinor, expenseMinor, netMinor }] }`, where
  `totals` covers every matching transaction, not just the page, with one entry
  per currency, since minor units of different currencies can't be added. A
  repeated parameter (`?categoryId=a&categoryId=b`) counts like a comma list.

- **Income from bookings** (per property, off by default:
  `GET`/`PUT /api/properties/:id/income-automation` with
  `{ enabled, onCancel: "delete" | "zero" }`):
  - When a booking is confirmed, it creates two income entries linked to the
    booking and marked `generated`. `booking_accommodation` holds the total
    less the cleaning fee, in "Booking income". `booking_cleaning` holds the
    cleaning fee, in "Cleaning fees".
  - Both are dated on the check-in day and follow the booking's amounts and
    dates. They're never duplicated.
  - Cancelling deletes them, or sets them to zero, per `onCancel`.
  - Bookings confirmed before the automation was on aren't backfilled.
  - Editing a generated entry by hand detaches it (`detachedAt` is set) and
    the response carries `warning.code: "detached_from_booking"`. From then
    on the automation leaves it alone.

### Recurring expenses

| Method and path                           | Does                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/recurring-expenses`             | Rules with `status` (`active`/`paused`/`ended`) and `nextDueDate`; filter `propertyId` |
| `POST /api/recurring-expenses`            | Create a rule (body below); periods already due are created at once                    |
| `GET /api/recurring-expenses/:id`         | One rule                                                                               |
| `PATCH /api/recurring-expenses/:id`       | `amountMinor`, `categoryId`, `endDate`, `description`, for periods not created yet     |
| `POST /api/recurring-expenses/:id/pause`  | Stop creating transactions; past ones stay                                             |
| `POST /api/recurring-expenses/:id/resume` | Start again from the next period on or after today                                     |
| `DELETE /api/recurring-expenses/:id`      | Delete the rule (`204`); its transactions stay                                         |

- **Body**: `propertyId`, `categoryId` (an expense category), `amountMinor`,
  `interval` (`monthly`, `quarterly` or `annual`), `startDate` (the first
  occurrence), optional `endDate` (the last day one may fall on) and
  `description`.
- **Dates**: occurrence n falls on the start date plus n intervals, on the
  same day of the month, or the month's last day when that month is shorter.
  So 31 Jan, 28 Feb, 31 Mar, and no drift afterwards.
- **The job** runs at server start and then hourly. It uses each property's
  local date and creates every period due by then, so a missed run is caught
  up by the next.
- **Duplicates**: transactions are unique per rule and date, so a period is
  never created twice. They're marked `isRecurring` with
  `recurringExpenseId`.
- **Pausing** skips the periods that fall due while the rule is paused.
  Rules of an archived property create nothing.

### Analytics

`GET /api/analytics?from=&to=` gives the dashboard every figure it shows, from
one tested aggregation layer ([`src/lib/analytics/rules.ts`](src/lib/analytics/rules.ts)
defines each one).

- **Query**: `from`, `to` (half-open like a stay, at most three years),
  `propertyId` (default: all properties), `compare` (`year`, the default: the
  same dates a year earlier; or `previous`: the same number of days right
  before) and `excludeBlocks` (default `true`).
- **Response**:
  - `months`: one entry per calendar month, clipped to the range at both
    ends. Each has `incomeMinor`, `expensesMinor` and `netMinor` from the
    ledger, plus `bookedNights`, `blockedNights`, `availableNights` and
    `accommodationRevenueMinor`.
  - `totals`: the same figures for the whole range, plus `occupancyRate`
    (0–1), `averageNightlyRateMinor` and `revenuePerAvailableNightMinor`.
    A rate is `null` when nothing is there to divide by.
  - `prior`: `{ compare, from, to, totals }`.
  - `change`: `{ delta, percent }` for each total.
  - `expensesByCategory`: `{ categoryId, name, color, amountMinor, share }`,
    largest first.
- **Rules**:
  - Only confirmed bookings occupy nights.
  - A booking's accommodation revenue (total less cleaning fee) is spread
    evenly over its nights, so a stay across a month boundary counts in each
    month for the nights it has there.
  - With `excludeBlocks`, nights blocked and not booked are left out of the
    available nights.
  - An archived property stops counting from the day it was archived.
- **Currencies**: amounts in different currencies are never added up. With
  mixed currencies across all properties the answer is `409` with
  `error.reason: "mixed_currencies"`; pass a `propertyId`.

### Calendar availability

`GET /api/availability?propertyIds=<id>,<id>&from=2026-07-01&to=2026-10-01`
returns everything a calendar view needs in one request. For each property
(at most 20, in the order asked) it returns:

- the property: name, colour, timezone, archived;
- its non-cancelled bookings and its blocks that touch `[from, to)`;
- `days`, night by night: `available`, `inquiry`, `booked` or `blocked`, with
  `checkIn`/`checkOut` turnover markers.

A window spans at most 366 days.

Responses are cached in the server process per property and window.
Booking writes invalidate exactly the cached windows whose dates they touch
(both old and new dates when a booking moves). Property changes invalidate
that property's windows, and guest renames and erasures clear the cache, since
windows show guest names. Writes made outside the app, such as the seed or
psql, appear within a minute.

### Erasing a guest's personal data (DSGVO Art. 17)

`POST /api/guests/:id/purge` with `{ "confirm": "<the guest's id>" }`. This
cannot be undone, which is why the id has to be repeated.

- **A guest with bookings is anonymised, not deleted.** Bookings are
  accounting records that must be kept (AO §147; Art. 17(3)(b) DSGVO).
  - Name becomes "Deleted guest"; email, phone and notes are cleared.
  - The notes on their bookings are cleared too. A booking references its
    guest by id only, so booking dates and amounts are untouched.
  - An audit event records that a purge happened, when and by whom, without
    any of the removed data. The audit trail is append-only in the database.
- **A guest without bookings is deleted** outright, with the same audit event.
- **Afterwards** the guest is read-only (`409` on edit), never appears in
  search or the typeahead, and can't be given new bookings. Purging again is
  harmless.

What a purge does **not** reach yet (details in
[`src/lib/guests/purge.ts`](src/lib/guests/purge.ts)):

- **Google Calendar events from outbound sync** (GitLab #70). Their titles and
  descriptions must not carry guest personal data, or the purge must update
  them.
- **Logs and error reports.** The app doesn't log guest records. Emails and
  phone fields are masked anyway, and request bodies never reach the error
  tracker. A guest's _name_ isn't pattern-masked, so it must never be logged.
- **Backups.** The data disappears from them once backup retention passes; the
  backup procedure (GitLab #95) documents that period.

## Testing

**Unit tests** use [Vitest](https://vitest.dev) and live next to the code they
cover as `*.test.ts`. They resolve `@/…` from `tsconfig.json`, exactly as the
app does, and need no database.

**Database tests** (`npm run test:db`) are Vitest files named `*.db.test.ts`,
run against a real PostgreSQL: the Compose `db` service, in a database of
their own (`vacation_home_test`), dropped and re-migrated before each run. They
cover what only the database can prove: constraints, exact money round-trips,
dates. They run with the process clock at UTC+14, so a calendar date pushed
through local time by mistake fails loudly.

```bash
docker compose up -d db
npm run test:db
```

**End-to-end tests** use [Playwright](https://playwright.dev) and live in
[`e2e/`](e2e). They need the Compose database running:

```bash
docker compose up -d db
npx playwright install chromium   # once, and after a Playwright upgrade
npm run test:e2e
```

Before building, each run drops and recreates a separate database, `vacation_home_e2e`, on
the same server and applies the committed migrations, so every run starts
empty and your development data is never touched. The harness refuses to reset
a database whose name does not end in `_test` or `_e2e`, or one on a host other
than the local and Compose/CI service names. Set
`E2E_DATABASE_URL` to point it elsewhere.

Playwright then builds the app and serves it with `next start` on port 3100,
with test-only credentials, so it runs alongside `npm run dev` without
conflict. It does overwrite any production build of your own in `.next`. The tests share the one database and so run serially.

## UI

Pages are built from a small set of shared primitives (page header, card, data
table, dialogs, empty, error and loading states, toasts) and the money and date
formatting helpers. [`src/components/README.md`](src/components/README.md)
documents each with usage examples, and `/dev/ui` renders them all while
`npm run dev` is running.

## Authentication

Sign-in is Google only, through [Auth.js](https://authjs.dev) with sessions
stored in the database ([`src/auth.ts`](src/auth.ts)).

- **Who can sign in**: verified Google accounts listed in `AUTH_ALLOWED_EMAILS`.
  Anyone else is sent back to the sign-in page with an explanation. The list
  is checked again on every request, so removing an address signs that
  account out on its next request.
- **Everything is private**: [`src/proxy.ts`](src/proxy.ts) requires a session
  on every route except `/signin` and Auth.js's own `/api/auth/*`. Pages
  redirect to sign-in and come back afterwards. API calls get a `401` instead.
- **Google client setup**: create an OAuth client of type "Web application"
  and add `<APP_URL>/api/auth/callback/google` and
  `<APP_URL>/api/google/callback` as authorised redirect URIs.
- **Sign-in asks for identity only** (`openid email profile`): no calendar
  access and no offline access, and no token from sign-in is stored.
- **Signing out** deletes the session row.

### Google Calendar access

Calendar access is a separate grant the user makes from settings, on top of
sign-in ([`src/lib/google/`](src/lib/google)):

- **Connecting**: `GET /api/google/connect` sends the browser to Google's
  consent screen with incremental authorisation (`include_granted_scopes`)
  for the `calendar` scope and offline access. Google returns to
  `/api/google/callback`, which checks the CSRF `state` (an httpOnly cookie
  bound to the user), stores the grant and redirects to
  `/settings?google=connected` (or `denied`, `scope_missing`, `unavailable`,
  `error`).
- **Tokens at rest** are encrypted with AES-256-GCM under
  `TOKEN_ENCRYPTION_KEY` ([`src/lib/secrets.ts`](src/lib/secrets.ts)). Without
  that key, connecting is unavailable; the rest of the app works.
- **Using it**: `getAccessToken(userId)` returns a valid access token,
  refreshing it when it is within a minute of expiry. Concurrent callers share
  one refresh.
- **Revoked access**: when Google answers a refresh with `invalid_grant`
  (access removed in the Google account, or the grant expired), the
  connection is marked `disconnected` with reason `revoked`, and callers get
  a `CalendarNotConnectedError`. `GET /api/google/connection` reports it so
  settings can show a "reconnect" prompt; reconnecting replaces the grant.
  The same response carries `sync`, a summary of the user's booking events
  in Google: `{ lastSyncedAt, pending, failed, lastError }`. It's `null`
  unless the account is connected. `lastError` is a fixed sentence for the
  latest failure's kind, never Google's text.
  Tokens sealed under an earlier `TOKEN_ENCRYPTION_KEY` do the same, with
  reason `key_changed`.
- **Disconnecting**: `DELETE /api/google/connection` revokes the grant at
  Google (best effort) and deletes it.

### Outbound sync: bookings in Google Calendar

Each property can push its bookings to one Google Calendar
([`src/lib/google/outbound.ts`](src/lib/google/outbound.ts)).

| Method and path                            | Does                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /api/google/calendars`                | The signed-in user's calendars the app can write to (read-only ones left out)     |
| `GET /api/properties/:id/calendar`         | `{ calendar: { calendarId, calendarName, outbound, inbound, userId } \| null }`   |
| `PUT /api/properties/:id/calendar`         | Choose it: `{ calendarId, outbound?, inbound? }`; schedules every current booking |
| `DELETE /api/properties/:id/calendar`      | Stop syncing (`204`); events already in Google stay as they are                   |
| `POST /api/properties/:id/calendar/resync` | "Resync everything" (`202 { scheduled }`)                                         |

- **What is pushed**: confirmed bookings, as all-day events from check-in to
  check-out. Cancelling (or turning back into an inquiry) deletes the event.
  The event reads "Booking · <property>" with the booking id, nights, guest
  count, total and a link to the app, and carries the private extended
  property `vacationHome=booking` plus `bookingId`. **No guest personal data
  goes to Google**, so erasing a guest never has to reach it.
- **How**: every booking write schedules its event in the same transaction
  (the link turns `pending` and its `changeSeq` goes up). A worker in the
  server process pushes at once after the change, and every 20 seconds
  picks up anything still due. Rapid edits collapse into one push of the
  latest version, a change made during a push is pushed right after, and the
  fixed event id means a retry never adds a second event.
- **Failures**: a failed push is `failed` with the error kind, retried after
  30 s, doubling to at most 1 h. A disconnected or revoked Google account
  stops all pushes until it is reconnected. An event deleted in Google is
  created again: the app's bookings are the truth.
- The worker runs only when `TOKEN_ENCRYPTION_KEY` is set.

### Inbound sync: changes in Google Calendar

For properties with `inbound: true` in their calendar settings, the app finds
out what changed in Google ([`src/lib/google/inbound.ts`](src/lib/google/inbound.ts))
and imports it as read-only blocks with `origin: "google"`
([`src/lib/google/inbound-import.ts`](src/lib/google/inbound-import.ts)).

- **What becomes a block:**
  - All-day events, on their own dates.
  - Timed events lasting at least `GOOGLE_IMPORT_MIN_TIMED_HOURS` (default
    12). They block every night they touch, in the property's timezone, so
    a meeting blocks nothing.
  - Never the app's own booking events: they carry its extended property,
    so a booking doesn't come back as a block. Never "free" events either.
- **Following Google:** moving an event moves its block. Deleting it, making
  it free or shortening it below the threshold removes the block. A full
  list removes the blocks of events that are no longer there.
- **No personal data:** a block keeps the Google event id and the dates, and
  its reason names only the source ("Google Calendar · <calendar name>").
  The event's title, description, location and attendees are never stored.
- **Conflicts:** an event over a confirmed booking isn't imported. It
  becomes a sync issue for review instead (`GET /api/calendar-sync/issues`,
  `POST /api/calendar-sync/issues/:id/dismiss`), and the count is
  `sync.openIssues` on `GET /api/google/connection`.
- **Who wins:** the booking wins over its own event, and Google wins over its
  own events. See [docs/calendar-sync.md](docs/calendar-sync.md) for the
  precedence rules and why sync can't loop.

How changes are found:

- **Polling, the default.** A LAN-only app can't receive Google's webhooks,
  so each calendar is checked every `GOOGLE_CALENDAR_POLL_SECONDS` (default
  300, minimum 60) with an incremental list. Google's sync token returns
  only what changed, deletions included. A worker in the server process
  runs the due checks every 30 seconds. A failed check backs off (30 s,
  doubling to 1 h), and a disconnected Google account pauses it.
- **No data lost.** The new sync token is stored only after the changes have
  been handled, so a failure is retried from the same point. An expired
  token (Google's `410`) triggers a full list instead.
- **Push notifications, optional.** With `GOOGLE_WEBHOOK_URL` set to a
  public https URL, each calendar also gets a Google push channel to
  `<url>/api/google/webhook`. Channels last a week and are renewed a day
  before they expire. A notification makes the next check happen at once,
  so changes arrive in seconds, and polling drops to hourly as a safety net.
- **The webhook route** is the one API path open without a session. It
  accepts only a notification naming a channel this app created, with that
  channel's secret token (stored as a SHA-256 hash) and resource id;
  anything else gets `401`. A notification carries no data: it only makes
  the next check happen sooner.

**Event links** ([`src/lib/google/links.ts`](src/lib/google/links.ts),
table `calendar_event_links`) map each booking or manual block to the Google
event pushed for it, one per calendar. The event id is chosen by the app
(`vh` + 32 hex digits) before the first insert, so a retry or re-run updates
the same event instead of duplicating it. Deleting the booking or block keeps
the link as `pending_delete` (a trigger), so the remote event can still be
deleted; `deleteRemoteEvent` then removes the link. A failure is recorded as
`failed` with its error kind, never Google's text.

**Calling the API**: `createCalendarClient({ userId })`
([`src/lib/google/calendar.ts`](src/lib/google/calendar.ts)) wraps calendar
list and event list/get/insert/update/delete:

- Rate limits (429, 403 `rateLimitExceeded`/`userRateLimitExceeded`), 5xx,
  network failures and timeouts are retried with exponential backoff and full
  jitter, honouring `Retry-After`, up to 5 attempts. A 401 refreshes the
  token once. One user's requests are spaced at least 100 ms apart.
- Every failure is a `GoogleCalendarError` with a `kind` (`rate_limited`,
  `quota_exceeded`, `not_found`, `gone`, `precondition_failed`, ...) and a
  `transient` flag that says whether a job should retry later. A revoked grant
  is a `CalendarNotConnectedError`.
- Inserting with a caller-chosen event id survives a retried insert that
  had already reached Google. Updates can pass an `etag` (`If-Match`).
  Deleting an event that is already gone counts as done.
- Every call is logged with its operation, calendar id, event id, status,
  attempt and duration, never a body.

End-to-end tests sign in by inserting a real session into their own test
database and sending its cookie. The app has no test-only login path that a
production deployment could have switched on.

## Logging and error tracking

**Logs** are JSON, one object per line on stdout, from
[`src/lib/logger.ts`](src/lib/logger.ts). Pipe through `npx pino-pretty` to read
them in development.

```ts
const log = await requestLogger(); // in a route handler, action or server component
log.info({ bookingId }, "booking saved");
log.error({ err }, "could not save booking");
```

**Request ids.** [`src/proxy.ts`](src/proxy.ts) gives every request an
`x-request-id`. It keeps a well-formed one from upstream and otherwise
generates one, and returns it in the response so a user can quote it.
`requestLogger()` stamps it on every line, and failed requests are logged
with it by the `onRequestError` hook. Background jobs run through `runJob()`
([`src/lib/jobs.ts`](src/lib/jobs.ts)), which carries the enqueuing request's id
into every line the job writes, alongside `job` and `jobId`. So a failed sync can
be traced back to the request that started it.

**No personal data or credentials in logs or error reports.**
[`src/lib/scrub.ts`](src/lib/scrub.ts) masks email addresses, OAuth and bearer
tokens, JWTs and token-bearing query parameters inside any string. It also
replaces the value of any field whose name marks it as sensitive (`email`,
`phone`, `token`, `secret`, `authorization`, `cookie`, …). It runs on every
logger call, on everything written through `console` on the server
(including Next's own error output), and on every event sent to the error
tracker.

**Error tracking** uses the Sentry SDK, which also talks to
[GlitchTip](https://glitchtip.com), an open-source, self-hostable tracker, and
to self-hosted Sentry. No hosted account is needed. It catches server errors
(via `onRequestError` in [`src/instrumentation.ts`](src/instrumentation.ts),
tagged with the request id), client errors (via `error.tsx`, `global-error.tsx`
and [`src/instrumentation-client.ts`](src/instrumentation-client.ts)) and failed
jobs. It is off until `NEXT_PUBLIC_SENTRY_DSN` is set. Events carry no cookies,
request bodies, user details or local variables.

- **Releases**: every event is tagged with a release, which is `SENTRY_RELEASE`,
  else the commit SHA (`CI_COMMIT_SHA` on GitLab), baked in at build time.
- **Source maps**: when `SENTRY_AUTH_TOKEN` (plus `SENTRY_URL`, `SENTRY_ORG`
  and `SENTRY_PROJECT`) is set at build time, source maps are uploaded and then
  deleted from the build output, so production stack traces resolve to the
  original source. Without a token the build skips this and needs no network.
- **Checking it works**: start the app with `ENABLE_ERROR_TEST_ROUTE=true` and
  open `/api/debug/error`. The error should show up in the tracker with the
  request's id and with the guest email in its message masked. In development,
  `/dev/ui` also has a button that throws a client-side error.

## Demo data

```bash
npm run seed                          # app on the host
docker compose exec app npm run seed  # everything in Docker
```

`npm run seed` **replaces** the properties, guests, bookings and blocks with
demo data:

- two properties, 20 guests, about 60 bookings over 18 months (October 2025 to
  March 2027);
- mostly confirmed bookings, plus inquiries and cancellations, from every
  source, with some same-day turnovers;
- a few owner blocks and Google Calendar blocks.

The content is identical on every run (fixed seed and fixed dates); the ids
are new each time. `prisma migrate reset` runs it too. Signed-in users and
the audit trail are left alone.

It refuses to run against anything but a development database: never with
`NODE_ENV=production`, only on a local or Compose host, and never on the test
databases (`*_test`, `*_e2e`).

## Configuration

Every environment variable is documented in [`.env.example`](.env.example) and
validated against a schema by [`src/env.ts`](src/env.ts). A missing or malformed
variable stops the process with a message naming it, rather than failing later
at the first database query or Google API call.

Validation is triggered from [`src/instrumentation.ts`](src/instrumentation.ts),
which Next runs once per server process. It deliberately does **not** run during
`next build`, so building an image does not require production secrets — only
starting the app does. During the build `env` validates lazily, on the first
value read, because the build imports server modules to collect page data;
reading a variable at build time still fails loudly.

`src/env.ts` is the only module permitted to read `process.env`; everything
else imports the typed `env` object from `@/env`. An ESLint rule enforces this.

## Scripts

| Script                             | Does                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                      | Development server                                                                                                      |
| `npm run build`                    | Production build                                                                                                        |
| `npm start`                        | Serve a production build                                                                                                |
| `npm run lint`                     | ESLint                                                                                                                  |
| `npm run lint:fix`                 | ESLint with autofix                                                                                                     |
| `npm run format`                   | Prettier, writing changes                                                                                               |
| `npm run format:check`             | Prettier, check only (used by CI)                                                                                       |
| `npm run typecheck`                | `next typegen`, then `tsc --noEmit`                                                                                     |
| `npm test`                         | Unit tests (Vitest), once                                                                                               |
| `npm run test:watch`               | Unit tests, re-running on change                                                                                        |
| `npm run test:db`                  | Database tests against PostgreSQL                                                                                       |
| `npm run test:e2e`                 | End-to-end tests (Playwright)                                                                                           |
| `npm run migrate:dev`              | Create and apply a migration (development)                                                                              |
| `npm run migrate:deploy`           | Apply committed migrations                                                                                              |
| `npm run studio`                   | Prisma Studio, a browser UI for the data                                                                                |
| `npm run seed`                     | Replace the data with deterministic demo data                                                                           |
| `npm run db:generate`              | Regenerate the Prisma client                                                                                            |
| `npm run guests:repurge -- <file>` | Erase again the guests a restore brought back ([docs](docs/backup-and-restore.md#5-after-a-restore-erase-guests-again)) |

## Continuous integration

[`.gitlab-ci.yml`](.gitlab-ci.yml) runs on merge requests and on the default
branch; a push to a branch with no open merge request builds nothing.

- `install` seeds two caches: npm's download store under a stable key, so it
  survives a dependency bump, and `node_modules` under the `package-lock.json`
  hash, since that tree is valid only for the lockfile that produced it.
- `quality` runs lint, typecheck and the Prettier check as parallel jobs, so a
  lint error and a type error are both reported instead of one masking the other.
- `test` runs the Vitest suite; `e2e` runs Playwright against a PostgreSQL
  16 service container, building and starting the app itself.
- `build` runs a production build with no environment variables, because
  validation happens at server boot rather than at build time.

The job image is pinned to the exact Node version in [`.nvmrc`](.nvmrc), and
`install` fails if the two ever drift apart.

## Code style

Prettier owns formatting and ESLint owns correctness — `eslint-config-prettier`
keeps the two from arguing. A husky pre-commit hook runs `lint-staged`, which
applies `eslint --fix` and `prettier --write` to staged files, so formatting is
corrected as you commit rather than reviewed in a merge request.

Line endings are LF everywhere, pinned by [`.gitattributes`](.gitattributes) so
that Windows checkouts agree with `.editorconfig` and Prettier.

## Troubleshooting

### "An Application Control policy has blocked this file"

Windows Smart App Control blocks Next's unsigned native binary
(`@next/swc-win32-x64-msvc`). Turbopack has no WASM fallback, so neither
`npm run dev` nor `npm run build` can run. Webpack does fall back to WASM:

```bash
npx next dev --webpack
npx next build --webpack
```

Or develop inside the Docker environment (`docker compose up`), which avoids
the host policy entirely. The same policy will block Prisma's native query
engine, so Docker is the more durable answer.
