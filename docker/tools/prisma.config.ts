/**
 * Prisma CLI configuration inside the tools image (Dockerfile, `tools`):
 * like the repository's prisma.config.ts, minus the .env loading - the
 * container gets its environment from compose - so the image needs no
 * Next.js package.
 */
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // The CLI's own configuration, outside the app: no `@/env` here.
  // eslint-disable-next-line no-restricted-properties
  datasource: { url: process.env.DATABASE_URL },
});
