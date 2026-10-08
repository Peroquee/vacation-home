/**
 * Resets the e2e database before the run: drop it, recreate it empty, apply
 * the committed migrations. Every run therefore starts from exactly the schema
 * `migrate:deploy` produces, with no rows left over from the last one.
 */
import { execFileSync } from "node:child_process";

import { Client } from "pg";

import { E2E_DATABASE_URL } from "./database";

export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));

  // This drops a database, so refuse anything that does not look disposable -
  // a mistyped E2E_DATABASE_URL must not be able to wipe the dev database.
  if (!/_(test|e2e)$/.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": the e2e database name must end in _test or _e2e.`,
    );
  }

  // DROP DATABASE cannot run against the database being dropped, so connect
  // to the server's maintenance database instead.
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    // FORCE ends connections left open by an aborted earlier run.
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "inherit",
  });
}
