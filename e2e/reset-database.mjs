/**
 * Resets the e2e database: drop it, recreate it empty, apply the committed
 * migrations. Every run therefore starts from exactly the schema
 * `migrate:deploy` produces, with no rows left over from the last one.
 *
 * Run by Playwright's webServer command, before the app is built - not as
 * `globalSetup`, which Playwright only runs after the web server is already
 * up. Plain JavaScript so Node runs it directly, with no TypeScript loader.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
const name = decodeURIComponent(url.pathname.slice(1));

// This drops a database, so refuse anything that does not look disposable:
// a mistyped or leaked URL must not be able to wipe the dev database, or any
// database on a shared server.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "db", "postgres"];
if (!/_(test|e2e)$/.test(name) || !LOCAL_HOSTS.includes(url.hostname)) {
  console.error(
    `Refusing to reset "${name}" on "${url.hostname}": the e2e database ` +
      `must be named *_test or *_e2e, on one of: ${LOCAL_HOSTS.join(", ")}.`,
  );
  process.exit(1);
}

// DROP DATABASE cannot run against the database being dropped, so connect to
// the server's maintenance database instead.
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

// The Prisma CLI through the current Node rather than `npx`, which on Windows
// is a .cmd file that execFile cannot spawn.
const prisma = createRequire(import.meta.url).resolve("prisma/build/index.js");
execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
  stdio: "inherit",
});
