import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Reads `paths` from tsconfig.json, so `@/...` resolves exactly as it does
    // in the app rather than through a second alias list that could drift.
    tsconfigPaths: true,
    // Server modules import "server-only" (GitLab #148), whose default entry
    // throws to keep them out of browser bundles; tests run them on the
    // server side, so it resolves to its empty entry, as Next does.
    alias: {
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    // Unit tests sit next to the code they cover, also the shell scripts'
    // (scripts/). Playwright owns e2e/.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // Database tests have their own suite: vitest.db.config.mts.
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts", "scripts/**/*.db.test.ts"],
    // Node by default. Component tests opt into a DOM with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // `npm run test:coverage` only (GitLab #133): a measurement, not a gate,
    // so no thresholds. The database suite reports to coverage/db. The
    // instrumentation slows the component tests, so the script raises
    // their timeout for this run only.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.{ts,mjs}"],
      exclude: ["src/generated/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage/unit",
    },
    // A valid configuration for modules that import `@/env`, which validates
    // on import. Placeholders only: unit tests never reach a real service.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5433/vacation_home_test",
      AUTH_SECRET: "unit-test-secret-unit-test-secret-1234",
      AUTH_GOOGLE_ID: "unit-test.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "unit-test-google-secret",
      AUTH_ALLOWED_EMAILS: "owner@example.test, Partner@Example.test",
      APP_URL: "http://localhost:3000",
    },
  },
});
