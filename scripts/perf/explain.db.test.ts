/**
 * scripts/perf/explain.sql (GitLab #97) against the test database: every
 * statement runs, so the script works the day it is needed on the real host.
 * psql's own lines (\set, \echo, \gset) are left out; the property it picks
 * is passed in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, expect, it } from "vitest";

import { db } from "@/lib/db";

afterAll(() => db.$disconnect());

it("explains every query without an error", async () => {
  const property = await db.property.create({
    data: { name: "Explain", timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
  });
  const sql = readFileSync(join(process.cwd(), "scripts/perf/explain.sql"), "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("\\") && !line.startsWith("--"))
    .join("\n")
    .replace(/SELECT id AS property[^;]*\\gset/, "")
    .replaceAll(":'property'", `'${property.id}'`);
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("SELECT id AS property"));
  expect(statements.length).toBeGreaterThanOrEqual(10);
  for (const statement of statements) {
    await expect(db.$queryRawUnsafe(statement), statement.slice(0, 80)).resolves.toBeDefined();
  }
});
