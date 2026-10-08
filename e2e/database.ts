/**
 * The disposable database the end-to-end run uses. It lives on the same
 * server as the development database (the Compose `db` service, or the
 * `postgres` service in CI) and is reset by e2e/reset-database.mjs before
 * every run.
 *
 * Tests arrange data with plain `pg`, not the generated Prisma client: that
 * client is ESM, and Playwright loads TypeScript in this package as CommonJS.
 */
import { Client } from "pg";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://vacation:vacation@localhost:5433/vacation_home_e2e";

/** Runs `fn` with a connection to the e2e database, closing it afterwards. */
export async function withE2eDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
