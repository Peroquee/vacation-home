/**
 * Prisma CLI configuration (migrate, generate, studio). The app itself does not
 * read this file; at runtime the client gets its connection from `@/env`.
 *
 * Prisma no longer loads .env files on its own. `loadEnvConfig` is the loader
 * Next uses, so the CLI sees the same variables, with the same file precedence,
 * as `npm run dev` does.
 */
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Development mode unless told otherwise, as for `next dev`: otherwise the
// loader would pick the .env.production* files, and `migrate dev` - which can
// reset a database - could end up pointed at production.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Run by `prisma migrate reset`, so a reset ends with demo data; guarded
    // against anything but a development database.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read leniently rather than through Prisma's `env()`, which throws when
    // the variable is unset. `prisma generate` needs no database, and runs on
    // every `npm install` - including in CI, where no environment exists.
    // Commands that do connect fail with Prisma's own error if it is missing.
    url: process.env.DATABASE_URL,
  },
});
