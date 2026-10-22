# Test review (GitLab #133)

The owner asked for a review of the tests and the test infrastructure,
alongside the UX review (#132). This is the review, not the rewrite: a
prioritised list for the owner to choose from. Every finding has an
example, a suggestion and an estimate of **effort** and **impact** (S/M/L).
The follow-up issues are created from the findings the owner picks.

Reviewed on 2026-10-22 against `main` at a2d859f. The whole suite was read
area by area with the `pr-review-toolkit` agents `pr-test-analyzer`
(coverage quality and gaps) and `silent-failure-hunter` (swallowed errors
in the code and in the test helpers). Every bug listed below was checked
against the code by hand, and the timezone ones were reproduced.

**In short:** the database tests are the strongest part of the suite. They
run on real PostgreSQL in a far-off timezone, inject the clock, test races,
and pin money amounts exactly. The weak spots are where data leaves the
core (emails, CSV, iCal, backups, deploy), state changes that bypass the
flows, and two kinds of tests that don't exist yet: a restore rehearsal
and a check after deploy. The review found **10 bugs**; none is a problem
in production today that loses money or data, but four could (B1, B2, B4,
B9).

## Top 10

| #   | Finding                                                                                                   | Effort | Impact |
| --- | --------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 1   | [Emails: one failing email makes the batch send again; timestamps depend on the server's timezone](#t1)   | S–M    | L      |
| 2   | [Status changes that bypass the booking flows](#t2)                                                       | M      | L      |
| 3   | [A refund comes back as income on CSV import; property tests for the money code](#t3)                     | S–M    | L      |
| 4   | [Privacy: the purge misses two free-text fields; "no cookies" is checked on four public pages only](#t4)  | S–M    | L      |
| 5   | [Backups: the restore was never rehearsed, and three silent failures in the scripts](#t5)                 | M      | L      |
| 6   | [iCal: an empty or broken feed frees the dates; times without a timezone shift a day](#t6)                | S–M    | L      |
| 7   | [Deploy: no check after the switch, no automatic rollback, deploys without waiting for Lighthouse](#t7)   | S–M    | L      |
| 8   | [Nothing stops server code (zod, Prisma) from reaching a browser bundle; the proxy has no unit test](#t8) | S–M    | M–L    |
| 9   | [Tests on the real clock: one DB test breaks on 2027-01-30, one fails on some month ends](#t9)            | S–M    | M      |
| 10  | [CI: one runner runs every job in turn; the app is built three times](#t10)                               | M      | M      |

Ranked by what a failure would cost (money, a guest's data, a double
booking, a lost backup), then by effort. Items 1, 3, 4 and 9 are small and
could ship together; 5 and 7 belong together (a restore rehearsal and a
post-deploy check share the stub-docker test pattern that
`scripts/deploy/backup-dir.test.ts` already uses).

## Bugs found

Reported to james as they were found. None is fixed here (this MR is the
review); each has the failing test that would show it.

| Bug | Where                                     | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Failing test to add                                                                                                                                                   |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `src/lib/email/outbox.ts:241-293`         | `sendDue` talks to SMTP inside the transaction that holds the rows. `renderEmail`, `issueGuestToken`, `bookingPolicy` and `getBankDetails` run before `deliver`'s `try` (line 211), so one throw rolls the whole batch back: emails already sent are pending again and go out again every minute, and the failing row, first in the order, blocks the queue. A batch slower than the 120 s transaction timeout does the same (the SMTP transport sets no timeouts).                                                          | 3 events, `renderEmail` throws for the 2nd: `sendDue` must not reject; row 1 sent, row 2 retried; a second `sendDue` sends no Message-ID twice.                       |
| B2  | `email_outbox` columns, `outbox.ts:65`    | `next_attempt_at` and `created_at` are `TIMESTAMP` without time zone. Prisma writes UTC, but the raw `INSERT` takes the default `CURRENT_TIMESTAMP` in the server's timezone. On a server not on UTC every email waits for the offset (2 h in summer), and the 30-day and 24-hour limits shift. Production runs on UTC (no `TZ` on the `db` service), so this is latent. Reproduced: on a Europe/Berlin server 5 of 6 outbox DB tests fail.                                                                                  | Run the DB suite's PostgreSQL sessions in a non-UTC zone (see [T9](#t9)); the existing outbox tests then fail.                                                        |
| B3  | `src/lib/bookings/service.ts:369`         | `PATCH /api/bookings/:id` refuses only `reserved` and `expired`. `{status:"cancelled"}` skips `cancelBooking`: no `cancelledBy/At`, no refund due, no "cancelled" event or email, and `/cancel` is then a no-op. `{status:"paid"}` on a reserved booking without payments is accepted too. Only the raw API can do these; the edit form offers inquiry, confirmed and the current status, but it can set reserved → confirmed without a payment, and cancelled → confirmed/inquiry, which keeps the old cancellation fields. | Reserve, record a 220.00 deposit, `PATCH {status:"cancelled"}`: expect 422 (today 200). Reinstating a cancelled booking clears `cancelledAt/By` and `refundDueMinor`. |
| B4  | `src/lib/booking-requests/inbox.ts:175`   | "Reinstate as inquiry" on an expired website request is undone by the next hourly run: the answer window counts from `createdAt`, and the `request_expired` event key is the same, so no one is told.                                                                                                                                                                                                                                                                                                                        | `expireRequests(day 4)` = 1, `PATCH {status:"inquiry"}`, `expireRequests(day 4 + 1 h)`: still `inquiry`.                                                              |
| B5  | `src/lib/finance/import.ts:186,242`       | The export writes a refund as `income,-20.00` (`csv.ts:12` says amounts are positive). The import takes the type from its column and stores `Math.abs`, so a refund comes back as +20.00 income. Today only the same-database duplicate check hides it.                                                                                                                                                                                                                                                                      | `csv-import.db.test.ts` round trip with a refund: the income per property is unchanged, or the row is refused.                                                        |
| B6  | `src/lib/guests/purge.ts:96-117`          | The DSGVO purge (and retention, and repurge, which use it) clears the booking notes and the request fields but not `bookings.tourist_tax_note` or `booking_payments.note` ("paid by M. Mustermann"). The leak scan in `purge.db.test.ts` doesn't look at `booking_payments`.                                                                                                                                                                                                                                                 | Fill both with "Zebulon", purge, scan every table that references a booking: 0 mentions.                                                                              |
| B7  | `src/lib/ical/parse.ts:89`                | `toJSDate()` reads a floating time, or a `TZID` without its `VTIMEZONE`, in the process's timezone. Reproduced: in production (UTC), `DTSTART;TZID=Europe/Berlin:20261024T230000` blocks from the 25th instead of the 24th. Platform feeds use whole days, so few real feeds hit it.                                                                                                                                                                                                                                         | `parse.test.ts`: that event, and a floating 23:00 one, parsed for Europe/Berlin under `TZ=Pacific/Kiritimati`: start 2026-10-24.                                      |
| B8  | `scripts/backup/restore.sh:227`           | It restarts the app saying "it applies any newer migrations on start". In production the image runs `node server.js`; migrations only run through the `migrate` tools service. Restoring an older dump leaves the schema behind the code until the next deploy.                                                                                                                                                                                                                                                              | Restore rehearsal ([T5](#t5)): restore a dump from migration N-1, then the latest migration is applied.                                                               |
| B9  | `scripts/backup/restore.sh:139-153`       | Before a live restore it reads the ids of erased guests. If that query fails (its errors go to `/dev/null`) it prints a note and swaps the database anyway, also with `--yes`. Guests erased after the backup come back and no "erase again" file is written.                                                                                                                                                                                                                                                                | Restore rehearsal with the query made to fail: the live restore stops.                                                                                                |
| B10 | `scripts/backup/receipts-mirror.sh:27-47` | If the receipts volume is missing or empty (Docker creates an empty folder), the copy reports "0 copied" and exits 0, and the prune marks every mirrored receipt as gone and deletes them all 186 days later. Every daily run looks healthy.                                                                                                                                                                                                                                                                                 | `receipts-backup.test.ts`: an empty source with a filled mirror fails and marks nothing.                                                                              |

Also wrong, smaller: `scripts/deploy/deploy.sh:20` promises that "if a step
fails, the version that was running keeps running", but the readiness check
runs after the switch ([T7](#t7)); `scripts/audit.mjs:96` accepts an
allow-list entry without `until` forever; `20261023010000_stay_times`
names a test file that doesn't exist (`stay-times.migration.db.test.ts`);
`e2e/app-routes.ts:4` names `e2e/access.spec.ts`, which doesn't exist.

## Inventory and timings

### Tests per layer and area

| Area                                               | Unit (Vitest) | Database (Vitest + PostgreSQL) | E2E (Playwright) |
| -------------------------------------------------- | ------------: | -----------------------------: | ---------------: |
| Bookings and the state machine                     |           189 |                            146 |               16 |
| Money: prices, deposit, payments, refunds, finance |           205 |                            129 |               12 |
| Public site, sign-in and access, privacy           |           129 |                             55 |               52 |
| Emails                                             |            15 |                              6 |                1 |
| Google Calendar and iCal                           |            48 |                             93 |                0 |
| Backups and deploy scripts                         |            20 |                              0 |                0 |
| Other (i18n, help, settings UI, shell, seed, perf) |           171 |                              4 |                3 |
| **Total**                                          |       **777** |                        **433** |  **84** (89 run) |

117 unit files, 49 database files, 31 e2e specs plus Lighthouse. E2E counts
are the `test(` calls per spec; CI runs 89 including the sign-in setup and
generated cases. There are no snapshot tests outside the email renderer.

### Run time

Measured locally (8 cores) and in CI pipeline 206 (main, a2d859f, green):

| Job / suite        | CI             | What takes the time                                                                                                        |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| install            | 40 s           | `npm ci` from the cache                                                                                                    |
| lint               | 22 s           |                                                                                                                            |
| audit              | 14 s           |                                                                                                                            |
| typecheck          | 22 s           |                                                                                                                            |
| format             | 16 s           |                                                                                                                            |
| test (unit)        | 35 s           | 777 tests; locally 29 s, of which the jsdom component files are most                                                       |
| e2e                | 181 s          | ~35 s start, services and cache; `test:db` 42 s (433 tests); reset and build ~32 s; 89 e2e tests 1.6 min; 9 s cache upload |
| lighthouse         | 156 s          | its own build plus 3 runs per page                                                                                         |
| build              | 43 s           | the third build of the same code                                                                                           |
| **pipeline total** | **8 min 49 s** | **= the sum of the jobs**: the single runner ("Vacation-Home") runs one job at a time                                      |

Slowest tests: `request-form.test.tsx` "solves a new spam check and sends
again" (3.7 s, the real proof-of-work), `analytics.db.test.ts` "answers a
twelve-month query in under 300 ms" (1.6 s, by design), and in e2e the
`booking-requests.spec.ts` 3.5 s wait for the anti-bot "time to fill the
form" rule. No test is slow enough to matter; the time is in the pipeline
around them ([T10](#t10)).

### Flakiness

_Pending: five local runs of the whole e2e suite (`npm run e2e:flaky`)._

CI history: of the last 8 pipelines, 1 failed (204, !108: two
`help.spec.ts` tests that the MR's own next commit fixed), so no flaky
test there either.

### Coverage (a measurement, not a gate)

`npm run test:coverage` (V8; reports in `coverage/unit` and `coverage/db`):

| Suite    | Lines | Branches | Functions |
| -------- | ----: | -------: | --------: |
| Unit     | 43.6% |    42.9% |     44.2% |
| Database | 37.5% |    31.1% |     29.9% |

By area, counting a file's lines as covered by whichever suite covers more
of them (a lower bound for both together; e2e not counted):

| Area                   | Lines | Covered |
| ---------------------- | ----: | ------: |
| Money                  |  1298 |    ≥91% |
| Google and iCal        |  1024 |    ≥91% |
| Bookings               |   975 |    ≥89% |
| Emails                 |   226 |    ≥83% |
| Components             |   709 |    ≥75% |
| Public site and access |   890 |    ≥66% |
| App pages (UI)         |  2999 |    ≥46% |
| Scripts (Node checks)  |   328 |      0% |

The low numbers are UI: the settings cards (seasons, Kurtaxe, discounts,
refund schedule, payment terms, bank details, access) and the booking
payments panel have no component test and are only reached by e2e.
`src/proxy.ts` has no unit test at all ([T8](#t8)). The shell scripts
aren't measured by V8; their tests are listed in the risk map.

## Risk map

Critical path → the tests that guard it → the gap. "Covered" means a
failure would be caught by a test that asserts the outcome, not only that
the code ran.

### Money

| Invariant                                                         | Guarded by                                                                                            | Gap                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Price per night by season, one-off beats yearly, New Year, 29 Feb | `pricing/engine.test.ts`                                                                              | Covered. A one-off season that wraps New Year inside a yearly one.                                                                          |
| Stay discount: highest tier, rounded, nights only                 | `engine.test.ts` "rounds to the nearest minor unit", "applies the highest tier"                       | Covered.                                                                                                                                    |
| Deposit = rounded % or fixed, capped, without Kurtaxe             | `payment-terms/terms.test.ts`; `tourist-tax.db.test.ts` "is left out of the deposit"                  | `holdFor` with Kurtaxe has no unit test; a fixed deposit ≥ total − Kurtaxe leaves a "balance" of only the Kurtaxe, unspecified.             |
| Estimate = stored total = deposit asked at reserve                | `pricing.db.test.ts` "the public estimate, the booking's total and the amount asked at reserve agree" | **Without Kurtaxe.** Add tax rules and a guest split to the agreement test.                                                                 |
| Refunds: negative income, schedule ramp, kept deposit             | `cancellation/policy.test.ts` (17 cases), `cancel.db.test.ts`, `payments/service.db.test.ts`          | CSV round trip (B5). Deleting a payment can leave net received below zero; the test at `service.db.test.ts:192` codifies it (product call). |
| Kurtaxe: by guest split and snapshot rules, own ledger category   | `tourist-tax.db.test.ts`, `tourist-tax.test.ts`                                                       | Overpayment, a payment across the boundary, a delete in the middle; `touristTaxIn`/`nextDue`/`netReceived` have no unit tests.              |
| Dashboard leaves out pass-through money                           | `tourist-tax.db.test.ts` "is no revenue on the dashboard"                                             | `analytics/rules.test.ts` never passes Kurtaxe.                                                                                             |
| JSON null never written into JSON columns                         | `cancel.db.test.ts` (refund schedule)                                                                 | Only that one column; `cancellation_policy`, `guest_split`, `stay_times` aren't checked.                                                    |

### Bookings, holds and expiry

| Invariant                                                       | Guarded by                                                                                             | Gap                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| The app's date-holding statuses = the DB constraint and trigger | `hold.db.test.ts` "are the same in the app and in the database"                                        | Covered.                                                                                                 |
| No overlap; two accepts at once                                 | `availability.db.test.ts`; `bookings.db.test.ts`; `hold.db.test.ts` "lets one of two accepted at once" | Covered.                                                                                                 |
| Status changes only through the flows                           | `hold.db.test.ts` "is the flow's to do" (reserved, expired only)                                       | B3, B4.                                                                                                  |
| An unpaid reservation expires; reminders once per due date      | `hold.db.test.ts` with an injected clock and Berlin midnight                                           | Expiry racing a deposit payment; one run over properties in different timezones; a DST changeover night. |
| Editing a reserved booking's dates                              | none                                                                                                   | Deadlines aren't recalculated; moving the arrival earlier can leave the balance due after it.            |
| A request expires after its answer window                       | `inbox.db.test.ts`                                                                                     | Reinstated requests (B4).                                                                                |
| Paid and reserved bookings block dates in the pure rule         | `availability/rules.test.ts` (confirmed, inquiry, cancelled)                                           | `reserved`, `paid` and `expired` cases.                                                                  |

### Access and privacy

| Invariant                                            | Guarded by                                                                                                | Gap                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything outside the allow-list refuses a stranger | `access.routes.test.ts` (from the route files); `public-site.spec.ts` (every route and method signed out) | Covered, and the strongest guard in the suite. Route files named `page.ts`/`route.js`, and `export { x as POST }`, would escape both sweeps silently.                       |
| No cookie on a public page                           | `cookies.spec.ts`, `public-site.spec.ts`: `/`, `/stay/[slug]`, the property API, legal pages              | **The guest page, `calendar.ics`, availability, stay-check, request-challenge, POSTs, photos and 404s aren't checked.** This is the gap behind the late Auth.js cookie bug. |
| A public page can't read the owner's session         | e2e checks `set-cookie` on the response only                                                              | No `proxy.test.ts` that proves Auth.js isn't called and the session cookies are stripped from the forwarded request.                                                        |
| The exact address only after full payment            | `render.test.ts`, `guest-stay.db.test.ts`, `listing.db.test.ts`                                           | No negative check on the deposit email's calendar file.                                                                                                                     |
| The public property data is an allow-list            | `listing.db.test.ts`, `public-calendar.spec.ts` (secret-string scan)                                      | `toPublicDto` has no key-set test, so a new field isn't a deliberate decision.                                                                                              |
| The purge and retention remove a guest's data        | `purge.db.test.ts` (scans whole rows), `inbox.db.test.ts`, `repurge.db.test.ts`                           | B6. Guest links never expire and survive a purge (product call).                                                                                                            |
| Only verified, allowed Google accounts sign in       | `access.test.ts`, `allowed-emails.db.test.ts`, `auth.spec.ts`                                             | The `email_verified` check in `auth.ts` can't be tested: `config()` isn't exported.                                                                                         |

### Data integrity, emails, integrations and operations

| Invariant                                          | Guarded by                                                         | Gap                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations, CHECKs, backfills                      | every DB run starts from `migrate deploy` on an empty database     | **No migration ever runs against rows.** A CHECK or NOT NULL added to a filled table is never tried. One backfill is re-run on the final schema (`stay-times.db.test.ts`). |
| Outbox: once per event and recipient; races; retry | `outbox.db.test.ts`                                                | B1, B2.                                                                                                                                                                    |
| Google sync: no echo loop, token refresh           | `links`, `outbound`, `inbound`, `conflicts`, `connection` DB tests | Covered (against fakes).                                                                                                                                                   |
| iCal import                                        | `parse.test.ts`, `import.db.test.ts`                               | B7. A valid but empty feed, or an unreadable event, deletes the future blocks ([T6](#t6)).                                                                                 |
| Backup and restore                                 | `receipts-backup.test.ts` (receipts), `backup-dir.test.ts`         | **`restore.sh` has never run in a test** (B8, B9). B10.                                                                                                                    |
| Deploy                                             | `backup-dir.test.ts` (dry run: backup folder, cache prune)         | `--rollback`, a failed readiness check, an unknown ref.                                                                                                                    |

## Findings

<a id="t1"></a>

### T1. Emails: one failing email makes the batch send again — S–M / L

B1 and B2 above. Suggestion: claim, commit, send and mark each row in its
own short transaction; treat any error from `deliver` as a retry; give the
SMTP transport connection and socket timeouts well below the transaction
budget; write `next_attempt_at`/`created_at` from the app (or make them
`timestamptz`). Tests: the failing ones in the bug table, plus `enqueue`
racing `sendDue`.

<a id="t2"></a>

### T2. Status changes that bypass the booking flows — M / L

B3 and B4. The tests treat a manual status edit as normal: `hold.db.test.ts:285`
and `:336` model the deposit arriving with `updateBooking({status:"confirmed"})`
instead of `recordPayment`, which hides this kind of hole. Suggestion:
decide per status which changes the owner may make by hand (likely only
inquiry ↔ confirmed for platform bookings), refuse the rest with 422, and
route cancel and reinstate through their flows. Tests: a table of every
from → to pair through `PATCH`, expected allowed or refused.

<a id="t3"></a>

### T3. Money: a refund becomes income on import; property-based tests — S–M / L

B5. The money code is pure, client-safe and fed by the owner's settings,
which suits property-based tests (`fast-check`, a dev dependency only).
Worth writing, in this order:

1. `parseAmount(minorToInput(x, c), c) === x` for 0, 2 and 3 minor digits,
   and "importing an export keeps the signed sum" (would have caught B5).
2. Total = nights − discount + cleaning + Kurtaxe; the nights in the lines
   add up to the stay; each night's price equals `rateOn` (a brute-force
   oracle, like the one `public-nights.test.ts` already uses).
3. `holdFor`: deposit ≤ total − Kurtaxe; today ≤ every due date ≤ the day
   before arrival; balance due ≥ deposit due.
4. `guestRefund`: kept + refunded = received; kept ≤ min(received, deposit).
5. Over any sequence of payments and refunds: the Kurtaxe entries add up to
   `touristTaxIn(net)`, and all entries to the net.

Not worth it for the UI or the database layer.

<a id="t4"></a>

### T4. Privacy: the purge misses two fields; cookies checked on four pages — S–M / L

B6. Suggestion: one e2e sweep over every public route in `PUBLIC_ROUTES`
× its methods, signed out **and** with the owner's cookie, asserting no
`set-cookie`, the public CSP and no 5xx. It replaces the per-page checks
and catches the next Auth.js cookie regression wherever it appears. Add
a key-set test for `toPublicDto`. Decide whether guest links should expire
or die with a purge.

<a id="t5"></a>

### T5. Backups: never rehearsed — M / L

B8, B9, B10. A restore rehearsal in the CI database job (links to #95):
seed realistic data, `pg_dump`, then run `restore.sh` with a stub `docker`
on the `PATH` that maps `docker compose exec -T db psql` to the CI service
(the pattern `backup-dir.test.ts` uses). Assert the row counts, the erased
guests found again, the staging database swapped in and the migrations
applied. Also from the scripts review: `scripts/deploy/backup-dir.sh` only
warns when the backup share isn't writable for the backup user, so the
deploy stays green while backups fail (exit non-zero instead, with an
opt-out); a dump of an empty database restores without a question.

<a id="t6"></a>

### T6. iCal: an empty feed frees the dates — S–M / L

`src/lib/ical/import.ts:128-134` deletes every future block whose event
is missing from the feed (that is how a cancellation on Airbnb reaches
us). `parse.ts` silently drops events it can't read. So a platform
glitch that serves an empty calendar, or one malformed event, makes those
nights bookable on the public site: a double booking. No test covers it.
Suggestion: refuse to delete all blocks (or more than a share) in one
import without a second fetch that agrees, count dropped events in the
feed's status, and test both. Plus B7.

<a id="t7"></a>

### T7. Deploy: no check after the switch — S–M / L

`deploy.sh` retags `current` and recreates the app before `wait_ready`;
when the app never becomes ready the job fails, but the new version is
what's running and nothing rolls back. `deploy.needs` leaves out
`lighthouse`, so main can deploy while Lighthouse still runs or before it
fails. Suggestion: after `wait_ready`, request `/api/ready`, `/` and a
public property page through Caddy, assert 0 cookies and the expected
version; on failure, roll back to `$previous` automatically. Test the
rollback branch with the stub `docker`. Add `lighthouse` to `needs` (or
state that it is advisory).

<a id="t8"></a>

### T8. Server code in browser bundles; the proxy — S–M / M–L

Nothing stops a `"use client"` file from importing zod, Prisma or `@/env`
(the late zod bug was caught by the bundle budget only because it crossed
it). Suggestion: `import "server-only"` in `db.ts`, `env.ts`, `auth.ts`,
`guest-link.ts` and the service modules (the build then fails), plus an
ESLint `no-restricted-imports` rule for client files. Add `src/proxy.ts`
unit tests with `auth` mocked to **throw**: a public path must never call
it, must strip the session cookies from the forwarded request, and must
answer 429 with `Retry-After` from the public bucket.

<a id="t9"></a>

### T9. Tests on the real clock — S–M / M

- `src/lib/cancellation/cancel.db.test.ts:19` hard-codes a stay on
  2027-03-01 but reserves on the real clock: from **2027-01-30** the
  default terms ask for the full amount and the "deposit received →
  confirmed" assertion (`:238`) fails. Some schedule tests cancel "on
  2026-09-01" a booking reserved today, so time runs backwards in them.
  Pass one fixed `NOW` everywhere, as `hold.db.test.ts` does.
- `src/lib/finance/recurring.db.test.ts:118-123` builds "two months ago"
  with `setUTCMonth` before `setUTCDate(1)`: on the 29th–31st of some months
  it rolls over (2 periods instead of 3), and in the last hour of a month
  (UTC) the Lisbon property is already in the next one (4).
- The DB suite sets `TZ=Pacific/Kiritimati` for Node (good) but not for
  PostgreSQL. B2 went unnoticed because CI's server is on UTC. Suggestion:
  add `options=-c timezone=Pacific/Kiritimati` to the test database URL.
- E2E: six specs copy a `day(n)` helper computed once at load in UTC; a
  run across midnight shifts the dates. One shared helper, read per test.
- Unit tests pin no `TZ`; set one in `vitest.config.mts` so local-time
  mistakes show the same everywhere. `kpis.test.ts:74` expects ICU's exact
  space in `"+12,5 %"`; match `\s` instead.

<a id="t10"></a>

### T10. CI speed — M / M

The project's one runner runs one job at a time, so the stages' parallelism
buys nothing: the pipeline takes the sum of its jobs (8 min 49 s). Waste:

- The same code is built three times (e2e, Lighthouse, build: ~35 s each
  plus their own job start). Build once in `build`, pass `.next` on as an
  artifact, and let e2e and Lighthouse only start it. Cache `.next/cache`.
- Four quality jobs each pay ~10–15 s of container start and cache
  restore for 5–10 s of work. One `quality` job running lint, typecheck,
  format and audit saves about 40 s on this runner.
- The e2e job's Playwright cache is uploaded again every run (9 s): use
  `policy: pull` except in one job.
- `test:db` runs inside the e2e job, so a DB failure hides the e2e result.
  A job of its own costs ~20 s on this runner but reports both.
- Lighthouse inherits Mailpit and the SMTP settings from e2e for nothing.
- No JUnit reports: GitLab's test tab is empty. Add `--reporter=junit`
  for Vitest and Playwright and `artifacts:reports:junit` (S).
- Screenshots on failure aren't kept (traces are): add
  `screenshot: "only-on-failure"`.

**Target:** ≤ 6 min on the current runner (build once, merge the quality
jobs), ≤ 4 min with the runner set to 3 concurrent jobs (then install →
quality ‖ unit ‖ build → e2e ‖ Lighthouse). Sharding e2e isn't worth it
yet: the 89 tests take 1.6 min. It would need each shard's own database,
and three specs clear whole tables (`emails.spec.ts`, `legal.spec.ts`,
`start-page.spec.ts`), which would have to be scoped first.

**"Pipeline success reported early"** (asked in the issue): nothing in
our configuration makes a job or a pipeline report success before it ends.
There is no `allow_failure`, and the `|| true` on the bundle report's JSON
line is followed by the real check. The likely cause is the waiting side:
right after a push the new pipeline doesn't exist for a few seconds, and a
wait that asks for "the latest pipeline of the branch" gets the previous,
finished one. Wait by commit sha instead. Also: `deploy` can finish before
`lighthouse` (above), and with auto-cancel a superseded pipeline ends
`canceled`, which a waiter must not read as passed.

## Test quality

| Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Effort | Impact |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| **Implementation details:** `legal/cookies.test.ts:22-40` parses Auth.js's source in `node_modules` with regexes; it breaks on a refactor and doesn't track behaviour (the e2e cookie check does). Its "no cookie set in our code" scan looks at three hard-coded files; grep all of `src/`.                                                                                                                                                                    | S      | M      |
| **Mocks that can't fail:** the next-intl mock in `vitest.setup.ts` renders a missing key as `ns.key` and only logs; a component test that doesn't assert that exact text passes with a typo in the key. Pass `onError` that throws. Otherwise mocking stops at the right boundaries (`fetch`, navigation, toast).                                                                                                                                               | S      | M      |
| **Assertions that can pass empty:** `e2e/listing.spec.ts:120-130` loops over `body.photos` and their sizes without checking there are any.                                                                                                                                                                                                                                                                                                                      | S      | S      |
| **Duplicated setup:** a Berlin property (250/night, 100 cleaning), a guest and an `inquiry()`/`pay()` helper are rebuilt in `hold`, `cancel`, `inbox`, `payments` and `tourist-tax` DB tests, each with its own cleanup list. A shared `src/lib/testing/booking.ts` fixture.                                                                                                                                                                                    | M      | M      |
| **Order-dependent data:** `tourist-tax.db.test.ts:185-195` depends on the helper's sort order; three e2e specs `DELETE` or `UPDATE` whole tables in `afterEach` (fine with one worker, a blocker for sharding).                                                                                                                                                                                                                                                 | S      | S      |
| **Brittle locators:** page-wide `getByText("Reserved"/"Confirmed"/"Paid", { exact: true })` (`reservation-hold.spec.ts:107,125,136`, `cancellation.spec.ts:89`, `payments.spec.ts`); `.first()` on a date cell that can exist twice (`booking-requests.spec.ts:63`, `public-calendar.spec.ts:175`); reading the reference with `dd.first()`. Scope to the status badge or a named region. `role=alert` is already scoped correctly (`owner-inbox.spec.ts:118`). | S      | M      |
| **Snapshots:** none that nobody reads; the email renderer's are checked against the text.                                                                                                                                                                                                                                                                                                                                                                       | —      | —      |
| **Vacuous checks in scripts:** `bundle-report.mjs` passes with zero routes or no default budget; `audit.mjs` passes if npm's JSON changes shape; `check-messages.mjs` flags empty messages only in German.                                                                                                                                                                                                                                                      | S      | S      |

## Missing kinds of tests

| Kind                                        | Worth it?                                                                                                                                                                                                                                                                                          | Effort | Impact |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| Restore rehearsal in CI (#95)               | **Yes**: three bugs live there ([T5](#t5)).                                                                                                                                                                                                                                                        | M      | L      |
| Smoke test after deploy                     | **Yes**, with automatic rollback ([T7](#t7)).                                                                                                                                                                                                                                                      | S      | L      |
| Migration test on real-shaped data          | **Yes**: migrate to N-1, seed every status, kind of payment and listing, then `migrate deploy` and check constraints and backfills. Plus a lint that refuses `DROP`/`RENAME`/`SET NOT NULL` without an allow-list entry, which backs `deploy.sh`'s "migrations only add" promise behind rollbacks. | M      | L      |
| Property-based tests for the price engine   | **Yes**, narrowly ([T3](#t3)).                                                                                                                                                                                                                                                                     | M      | M      |
| Visual regression with the #132 screenshots | **Not yet**: the UI is about to change after #132, and the screenshots differ by font and machine. Later, if at all, the public property page and the email HTML, in a pinned container.                                                                                                           | M      | S      |

## Local setup without sudo

What #132 and this review needed on a machine with no Docker and no
PostgreSQL (Debian 12, no root):

1. PostgreSQL 16: `npm pack @embedded-postgres/linux-x64@16.14.0-beta.17`,
   unpack, `initdb` and `pg_ctl start` on port 5433 with user and password
   `vacation`. Its server timezone follows the machine (Europe/Berlin
   here), which exposed B2; until that is fixed, add
   `?options=-c%20timezone%3DUTC` to `TEST_DATABASE_URL` and
   `E2E_DATABASE_URL`.
2. Chromium's libraries: `apt-get download` the packages Playwright lists
   and unpack them with `dpkg -x`; point `LD_LIBRARY_PATH` at them and
   `FONTCONFIG_FILE` at a fonts.conf for the unpacked fonts.
3. Mailpit: the release binary (v1.31.3, as in CI) with
   `--smtp 127.0.0.1:1025 --listen 127.0.0.1:8025`, then
   `E2E_SMTP_HOST=localhost E2E_MAILPIT_URL=http://localhost:8025`.

Worth a follow-up: a `scripts/dev/local-test-env.sh` that does these
steps idempotently, and `E2E_PORT` in `playwright.config.ts` so e2e can
run while another server holds 3100.

## How to rerun

- `npm run test:coverage`: unit and database coverage (the database part
  needs `TEST_DATABASE_URL`, as `npm run test:db` does). A measurement:
  no thresholds, and the timeout is raised for this run because the
  instrumentation slows the component tests.
- `npm run e2e:flaky` (`-- --runs N`, `-- --report`, `-- --dry-run`): runs
  the whole e2e suite N times (default 5), each from a fresh database,
  then lists every test that ever failed and the slowest ones. Reports
  are kept in `test-results-flaky/`, so an interrupted measurement can be
  summarised or continued.
- CI timings: the job list of any pipeline (GitLab → Build → Pipelines).
