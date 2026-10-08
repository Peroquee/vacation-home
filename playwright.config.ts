import { defineConfig, devices } from "@playwright/test";

import { E2E_DATABASE_URL } from "./e2e/database";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The tests share one database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build rather than `next dev`: it is what ships, and it
    // never shares a port or a .next/dev directory with your dev server.
    command: `npm run build && npm start -- --port ${PORT}`,
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
      APP_URL: baseURL,
    },
  },
});
