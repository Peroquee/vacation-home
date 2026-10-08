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
- `test` is wired up but empty until the suites in #44 land.
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
