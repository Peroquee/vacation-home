/**
 * "Today" is a date somewhere (GitLab #139): at 00:30 in Berlin it is
 * already the next day there, while UTC still has the day before.
 */
import { ESLint } from "eslint";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appToday } from "./app-today";
import { todayIn } from "./today";

/** 00:30 on 15 July 2026 in Berlin (summer time), 22:30 on the 14th in UTC. */
const HALF_PAST_MIDNIGHT_BERLIN = new Date("2026-07-14T22:30:00Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("todayIn", () => {
  it("is the date in the given timezone, not in UTC", () => {
    expect(todayIn("Europe/Berlin", HALF_PAST_MIDNIGHT_BERLIN)).toBe("2026-07-15");
    expect(todayIn("UTC", HALF_PAST_MIDNIGHT_BERLIN)).toBe("2026-07-14");
    expect(todayIn("America/Los_Angeles", HALF_PAST_MIDNIGHT_BERLIN)).toBe("2026-07-14");
  });

  it("reads the clock when given no instant", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HALF_PAST_MIDNIGHT_BERLIN);
    expect(todayIn("Europe/Berlin")).toBe("2026-07-15");
  });
});

describe("appToday", () => {
  it("is the date in the app's timezone, Europe/Berlin unless APP_TIMEZONE says otherwise", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HALF_PAST_MIDNIGHT_BERLIN);
    expect(appToday()).toBe("2026-07-15");
  });
});

describe("the lint rule against a UTC today", () => {
  const lint = async (code: string, filePath = "src/app/example.tsx") => {
    const [result] = await new ESLint({ cwd: process.cwd() }).lintText(code, { filePath });
    return result!.messages.filter((m) => m.ruleId === "no-restricted-syntax").length;
  };

  it("flags today's date taken from a bare new Date()", async () => {
    expect(await lint("export const a = new Date().toISOString().slice(0, 10);\n")).toBe(1);
    expect(await lint("export const b = new Date().getUTCFullYear();\n")).toBe(1);
    expect(await lint("export const c = new Date().getFullYear();\n")).toBe(1);
  });

  it("leaves instants and dates of a given moment alone", async () => {
    expect(await lint("export const a = new Date().toISOString();\n")).toBe(0);
    expect(await lint("export const f = (d: Date) => d.toISOString().slice(0, 10);\n")).toBe(0);
    expect(await lint("export const y = new Date(0).getUTCFullYear();\n")).toBe(0);
  });

  it("does not apply to tests", async () => {
    expect(
      await lint("export const a = new Date().toISOString().slice(0, 10);\n", "src/app/x.test.ts"),
    ).toBe(0);
  });
});
