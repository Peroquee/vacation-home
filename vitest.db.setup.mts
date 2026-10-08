import { resetDatabase } from "./e2e/reset-database.mjs";

/** Resets the test database once, before any database test runs. */
export default async function setup() {
  await resetDatabase(
    process.env.TEST_DATABASE_URL ??
      "postgresql://vacation:vacation@localhost:5433/vacation_home_test",
  );
}
