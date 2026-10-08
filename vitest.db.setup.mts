import pg from "pg";
import type { TestProject } from "vitest/node";

import { resetDatabase } from "./e2e/reset-database.mjs";

/** The system categories as the migrations create them, by system key. */
export type SystemCategorySnapshot = { systemKey: string; name: string; color: string }[];

declare module "vitest" {
  export interface ProvidedContext {
    systemCategories: SystemCategorySnapshot;
  }
}

/**
 * Resets the test database once, before any database test runs, and hands
 * every file the system categories as the migrations left them, so each file
 * can start from exactly that state (vitest.db.each-file.mts).
 */
export default async function setup(project: TestProject) {
  // Set by vitest.db.config.mts, which loads first.
  await resetDatabase(process.env.TEST_DATABASE_URL);

  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ systemKey: string; name: string; color: string }>(
      `SELECT system_key AS "systemKey", name, color FROM categories WHERE is_system`,
    );
    project.provide("systemCategories", rows);
  } finally {
    await client.end();
  }
}
