import { resetDatabase } from "./e2e/reset-database.mjs";

/** Resets the test database once, before any database test runs. */
export default async function setup() {
  // Set by vitest.db.config.mts, which loads first.
  await resetDatabase(process.env.TEST_DATABASE_URL);
}
