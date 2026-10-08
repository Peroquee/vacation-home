import { defineConfig, devices } from "@playwright/test";

import { E2E_DATABASE_URL, E2E_USER, STORAGE_STATE } from "./e2e/database";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  // The tests share one database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  // No retries: the database is reset once per run, not per attempt, so a
  // retry would see the first attempt's rows. A flaky test gets fixed instead.
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      // Signed in as the e2e user; a test that needs to be signed out says so
      // with test.use({ storageState: { cookies: [], origins: [] } }).
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    // Reset the database first, so a refused or failed reset stops the run
    // before the build. Then a production build rather than `next dev`: it is
    // what ships, and never shares a port or .next/dev with your dev server.
    command: `node e2e/reset-database.mjs && npm run build && npm start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      // Test-only values. `next start` runs in production mode, which rejects
      // the .env.example placeholders, so these deliberately differ from them.
      AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
      AUTH_GOOGLE_ID: "e2e.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "e2e-google-secret",
      AUTH_ALLOWED_EMAILS: E2E_USER.email,
      APP_URL: baseURL,
    },
  },
});
