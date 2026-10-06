# Vacation Rental Manager

Booking calendar, Google Calendar sync and finance tracking for a small number
of vacation rental properties.

**Stack:** Next.js (App Router) + TypeScript · PostgreSQL + Prisma ·
Tailwind + shadcn/ui · Auth.js (Google OAuth) · Recharts · Docker

## Requirements

- Node — the version in [`.nvmrc`](.nvmrc). With [fnm](https://github.com/Schniz/fnm)
  or nvm installed, `fnm use` / `nvm use` picks it up automatically.
- PostgreSQL (arrives via Docker Compose in a later change).

## Getting started

```bash
npm install
cp .env.example .env    # then fill in the blanks
npm run dev
```

## Configuration

Every environment variable is documented in [`.env.example`](.env.example) and
validated against a schema by [`src/env.ts`](src/env.ts). A missing or malformed
variable stops the process with a message naming it, rather than failing later
at the first database query or Google API call.

Validation is triggered from [`src/instrumentation.ts`](src/instrumentation.ts),
which Next runs once per server process. It deliberately does **not** run during
`next build`, so building an image does not require production secrets — only
starting the app does.

`src/env.ts` is the only module permitted to read `process.env`; everything
else imports the typed `env` object from `@/env`. An ESLint rule enforces this.

## Scripts

| Script                 | Does                                |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Development server                  |
| `npm run build`        | Production build                    |
| `npm start`            | Serve a production build            |
| `npm run lint`         | ESLint                              |
| `npm run lint:fix`     | ESLint with autofix                 |
| `npm run format`       | Prettier, writing changes           |
| `npm run format:check` | Prettier, check only (used by CI)   |
| `npm run typecheck`    | `next typegen`, then `tsc --noEmit` |

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

Or develop inside the Docker environment, which avoids the host policy
entirely. The same policy will block Prisma's native query engine, so Docker is
the more durable answer.
