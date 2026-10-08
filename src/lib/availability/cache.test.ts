import { beforeEach, describe, expect, it } from "vitest";

import {
  clearWindows,
  invalidateWindows,
  readWindow,
  TTL_MS,
  writeWindow,
} from "@/lib/availability/cache";

const july = { start: "2026-07-01", end: "2026-08-01" };
const august = { start: "2026-08-01", end: "2026-09-01" };

beforeEach(() => clearWindows());

describe("the calendar window cache", () => {
  it("returns what was written, per property and window", () => {
    writeWindow("lake", july, "lake-july");
    expect(readWindow("lake", july)).toBe("lake-july");
    expect(readWindow("lake", august)).toBeUndefined();
    expect(readWindow("cabin", july)).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    writeWindow("lake", july, "x", 1_000);
    expect(readWindow("lake", july, 1_000 + TTL_MS - 1)).toBe("x");
    expect(readWindow("lake", july, 1_000 + TTL_MS)).toBeUndefined();
  });

  it("invalidates exactly the windows a change touches", () => {
    writeWindow("lake", july, "july");
    writeWindow("lake", august, "august");
    writeWindow("cabin", july, "cabin");

    invalidateWindows("lake", [{ start: "2026-07-10", end: "2026-07-14" }]);
    expect(readWindow("lake", july)).toBeUndefined();
    expect(readWindow("lake", august)).toBe("august");
    expect(readWindow("cabin", july)).toBe("cabin");
  });

  it("counts a stay ending on a window's first day as touching it", () => {
    writeWindow("lake", august, "august");
    invalidateWindows("lake", [{ start: "2026-07-28", end: "2026-08-01" }]);
    expect(readWindow("lake", august)).toBeUndefined();
  });

  it("invalidates all of a property's windows without a range", () => {
    writeWindow("lake", july, "july");
    writeWindow("lake", august, "august");
    invalidateWindows("lake");
    expect([readWindow("lake", july), readWindow("lake", august)]).toEqual([undefined, undefined]);
  });
});
