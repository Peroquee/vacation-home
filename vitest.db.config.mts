import { defineConfig } from "vitest/config";

/**
 * Tests that need a real PostgreSQL: `*.db.test.ts`, run with `npm run
 * test:db`. The database is reset (dropped, recreated, migrated) once before
 * the run, and files run one at a time since they share it.
 *
 * Needs the Compose database (`docker compose up -d db`) locally; in CI the
 * e2e job's postgres service. TEST_DATABASE_URL overrides the target.
 */
// Resolved once, here: vitest.db.setup.mts runs in this same process and
// resets exactly this database.
process.env.TEST_DATABASE_URL ??=
  "postgresql://vacation:vacation@localhost:5433/vacation_home_test";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.db.test.ts", "scripts/**/*.db.test.ts"],
    environment: "node",
    globalSetup: ["./vitest.db.setup.mts"],
    // Each file starts from a clean database; see the file for why.
    setupFiles: ["./vitest.db.each-file.mts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: "db-test-secret-db-test-secret-1234567",
      AUTH_GOOGLE_ID: "db-test.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "db-test-google-secret",
      AUTH_ALLOWED_EMAILS: "owner@example.test",
      APP_URL: "http://localhost:3000",
      // 32 bytes, base64: Google tokens are stored encrypted.
      TOKEN_ENCRYPTION_KEY: "ZGItdGVzdC1rZXktZGItdGVzdC1rZXktZGItdGVzdC0=",
      // Run as far from UTC as possible, so any calendar date that is
      // accidentally pushed through local time shifts and fails loudly.
      TZ: "Pacific/Kiritimati",
    },
  },
});
