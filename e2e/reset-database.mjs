/**
 * Resets a disposable test database: drop it, recreate it empty, apply the
 * committed migrations. Every run therefore starts from exactly the schema
 * `migrate:deploy` produces, with no rows left over from the last one.
 *
 * Used two ways:
 * - run directly with DATABASE_URL set, by Playwright's webServer command,
 *   before the app is built (Playwright runs `globalSetup` only after the web
 *   server is up, too late);
 * - imported by the database test suite's global setup (vitest.db.config.mts).
 *
 * Plain JavaScript so Node runs it directly, with no TypeScript loader.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import pg from "pg";

// This drops a database, so refuse anything that does not look disposable:
// a mistyped or leaked URL must not be able to wipe the dev database, or any
// database on a shared server.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "db", "postgres"];

export async function resetDatabase(databaseUrl) {
  const url = new URL(databaseUrl ?? "");
  const name = decodeURIComponent(url.pathname.slice(1));

  if (!/_(test|e2e)$/.test(name) || !LOCAL_HOSTS.includes(url.hostname)) {
    throw new Error(
      `Refusing to reset "${name}" on "${url.hostname}": the database ` +
        `must be named *_test or *_e2e, on one of: ${LOCAL_HOSTS.join(", ")}.`,
    );
  }

  // DROP DATABASE cannot run against the database being dropped, so connect
  // to the server's maintenance database instead.
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    // FORCE ends connections left open by an aborted earlier run.
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }

  // The Prisma CLI through the current Node rather than `npx`, which on
  // Windows is a .cmd file that execFile cannot spawn.
  const prisma = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "inherit",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await resetDatabase(process.env.DATABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
