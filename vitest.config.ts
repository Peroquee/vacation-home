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
    environment: "node",
  },
});
