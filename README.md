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
validated against a schema at boot by [`src/env.ts`](src/env.ts). A missing or
malformed variable stops the process with a message naming it, rather than
failing later at the first database query or Google API call.

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

## Code style

Prettier owns formatting and ESLint owns correctness — `eslint-config-prettier`
keeps the two from arguing. A husky pre-commit hook runs `lint-staged`, which
applies `eslint --fix` and `prettier --write` to staged files, so formatting is
corrected as you commit rather than reviewed in a merge request.

Line endings are LF everywhere, pinned by [`.gitattributes`](.gitattributes) so
that Windows checkouts agree with `.editorconfig` and Prettier.
