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

## API

JSON route handlers under `src/app/api`. Errors always look like:

```json
{ "error": { "code": "validation_failed", "message": "…", "fields": { "name": ["is required"] } } }
```

`code` is one of `invalid_json` (400), `not_found` (404), `conflict` (409) or
`validation_failed` (422). Under `validation_failed`, `fields` has one list of
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

## Testing

**Unit tests** use [Vitest](https://vitest.dev) and live next to the code they
cover as `*.test.ts`. They resolve `@/…` from `tsconfig.json`, exactly as the
app does, and need no database.

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
  and add `<APP_URL>/api/auth/callback/google` as an authorised redirect URI.
  The same client will later request Calendar access, so sign-in already asks
  for offline access. The refresh token is stored on the account and replaced
  on every sign-in.
- **Signing out** deletes the session row.

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

| Script                   | Does                                       |
| ------------------------ | ------------------------------------------ |
| `npm run dev`            | Development server                         |
| `npm run build`          | Production build                           |
| `npm start`              | Serve a production build                   |
| `npm run lint`           | ESLint                                     |
| `npm run lint:fix`       | ESLint with autofix                        |
| `npm run format`         | Prettier, writing changes                  |
| `npm run format:check`   | Prettier, check only (used by CI)          |
| `npm run typecheck`      | `next typegen`, then `tsc --noEmit`        |
| `npm test`               | Unit tests (Vitest), once                  |
| `npm run test:watch`     | Unit tests, re-running on change           |
| `npm run test:e2e`       | End-to-end tests (Playwright)              |
| `npm run migrate:dev`    | Create and apply a migration (development) |
| `npm run migrate:deploy` | Apply committed migrations                 |
| `npm run studio`         | Prisma Studio, a browser UI for the data   |
| `npm run db:generate`    | Regenerate the Prisma client               |

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
