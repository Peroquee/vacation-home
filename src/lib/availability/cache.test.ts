import { beforeEach, describe, expect, it } from "vitest";

import {
  clearWindows,
  invalidateWindows,
  readWindow,
  ticket,
  TTL_MS,
  writeWindow,
} from "@/lib/availability/cache";

/** Writes as a load would: with a ticket taken now. */
const put = (
  propertyId: string,
  range: { start: string; end: string },
  value: unknown,
  now?: number,
) => writeWindow(propertyId, range, value, ticket(propertyId), now);

const july = { start: "2026-07-01", end: "2026-08-01" };
const august = { start: "2026-08-01", end: "2026-09-01" };

beforeEach(() => clearWindows());

describe("the calendar window cache", () => {
  it("returns what was written, per property and window", () => {
    put("lake", july, "lake-july");
    expect(readWindow("lake", july)).toBe("lake-july");
    expect(readWindow("lake", august)).toBeUndefined();
    expect(readWindow("cabin", july)).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    put("lake", july, "x", 1_000);
    expect(readWindow("lake", july, 1_000 + TTL_MS - 1)).toBe("x");
    expect(readWindow("lake", july, 1_000 + TTL_MS)).toBeUndefined();
  });

  it("invalidates exactly the windows a change touches", () => {
    put("lake", july, "july");
    put("lake", august, "august");
    put("cabin", july, "cabin");

    invalidateWindows("lake", [{ start: "2026-07-10", end: "2026-07-14" }]);
    expect(readWindow("lake", july)).toBeUndefined();
    expect(readWindow("lake", august)).toBe("august");
    expect(readWindow("cabin", july)).toBe("cabin");
  });

  it("counts a stay ending on a window's first day as touching it", () => {
    put("lake", august, "august");
    invalidateWindows("lake", [{ start: "2026-07-28", end: "2026-08-01" }]);
    expect(readWindow("lake", august)).toBeUndefined();
  });

  it("invalidates all of a property's windows without a range", () => {
    put("lake", july, "july");
    put("lake", august, "august");
    invalidateWindows("lake");
    expect([readWindow("lake", july), readWindow("lake", august)]).toEqual([undefined, undefined]);
  });

  it("drops a load's answer when the property was invalidated while it loaded", () => {
    const before = ticket("lake");
    invalidateWindows("lake", [{ start: "2026-07-10", end: "2026-07-12" }]);
    writeWindow("lake", july, "stale", before);
    expect(readWindow("lake", july)).toBeUndefined();

    // Other properties' loads are unaffected.
    const cabin = ticket("cabin");
    invalidateWindows("lake");
    writeWindow("cabin", july, "fresh", cabin);
    expect(readWindow("cabin", july)).toBe("fresh");
  });

  it("drops every load in flight when the cache is cleared", () => {
    const before = ticket("lake");
    clearWindows();
    writeWindow("lake", july, "stale name", before);
    expect(readWindow("lake", july)).toBeUndefined();
  });
});
