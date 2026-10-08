import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Reads `paths` from tsconfig.json, so `@/...` resolves exactly as it does
    // in the app rather than through a second alias list that could drift.
    tsconfigPaths: true,
  },
  test: {
    // Unit tests sit next to the code they cover. Playwright owns e2e/.
    include: ["src/**/*.test.{ts,tsx}"],
    // Node by default. Component tests opt into a DOM with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // A valid configuration for modules that import `@/env`, which validates
    // on import. Placeholders only: unit tests never reach a real service.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5433/vacation_home_test",
      AUTH_SECRET: "unit-test-secret-unit-test-secret-1234",
      AUTH_GOOGLE_ID: "unit-test.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "unit-test-google-secret",
      APP_URL: "http://localhost:3000",
    },
  },
});
