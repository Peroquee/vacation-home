/**
 * The UX review's screenshots (GitLab #132): `npm run ux:screenshots`.
 *
 * Not a test suite: it seeds a database of its own with realistic data
 * (scripts/ux/seed.ts), then photographs every main page, admin and public,
 * at phone (390 px) and desktop (1440 px) width, in light and dark, in
 * German, into docs/ux-review/screens/. Rerun it after a change to compare.
 *
 * The database is a third disposable one next to the e2e and test databases,
 * so a review run never disturbs either.
 */
import { defineConfig } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/** The e2e database's server, under a name of its own. */
export const UX_DATABASE_URL =
  process.env.UX_DATABASE_URL ??
  (
    process.env.E2E_DATABASE_URL ??
    "postgresql://vacation:vacation@localhost:5433/vacation_home_e2e"
  ).replace(/\/[^/?]+(\?|$)/, "/vacation_home_ux_e2e$1");
// e2e/database.ts (the session helper) reads this when it loads.
process.env.E2E_DATABASE_URL = UX_DATABASE_URL;

export default defineConfig({
  testDir: "e2e/ux",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Some pages are photographed in many states; a page that never settles
  // should fail the run rather than hang it.
  timeout: 10 * 60_000,
  reporter: "list",
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    // A step that finds nothing should say so, not wait out the test.
    actionTimeout: 15_000,
  },
  webServer: {
    // Fresh database, the review seed, then the production build, as e2e.
    // UX_REUSE_SERVER=1 skips all three and uses a server already running on
    // the port (seeded the same way), for quick reruns of the spec alone.
    command: `node e2e/reset-database.mjs && npx tsx --import ./scripts/server-only-hook.mjs scripts/ux/seed.ts && npm run build && npm start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: Boolean(process.env.UX_REUSE_SERVER),
    timeout: 300_000,
    env: {
      DATABASE_URL: UX_DATABASE_URL,
      AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
      AUTH_GOOGLE_ID: "e2e.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "e2e-google-secret",
      AUTH_ALLOWED_EMAILS: "e2e-owner@example.test",
      APP_URL: baseURL,
    },
  },
});
