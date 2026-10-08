import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value);
  return (await import("@/env")).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("optional settings", () => {
  it("treat a blank value as unset, so the default applies", async () => {
    const env = await loadEnv({ LOG_LEVEL: "", ENABLE_ERROR_TEST_ROUTE: " " });
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.ENABLE_ERROR_TEST_ROUTE).toBe(false);
  });

  it("ignore case and accept the usual spellings of true", async () => {
    const env = await loadEnv({ LOG_LEVEL: "DEBUG", ENABLE_ERROR_TEST_ROUTE: "Yes" });
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.ENABLE_ERROR_TEST_ROUTE).toBe(true);
  });

  it("still reject a value that means nothing", async () => {
    await expect(loadEnv({ LOG_LEVEL: "verbose" })).rejects.toThrow(/LOG_LEVEL/);
  });
});
