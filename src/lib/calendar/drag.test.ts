import { describe, expect, it } from "vitest";

import { draggedStay, pastThreshold } from "./drag";

const stay = { checkIn: "2026-07-10", checkOut: "2026-07-15" };

describe("draggedStay", () => {
  it("moves the whole stay by the days dragged", () => {
    expect(draggedStay(stay, "move", "2026-07-12", "2026-07-14")).toEqual({
      checkIn: "2026-07-12",
      checkOut: "2026-07-17",
    });
    expect(draggedStay(stay, "move", "2026-07-12", "2026-07-09")).toEqual({
      checkIn: "2026-07-07",
      checkOut: "2026-07-12",
    });
  });

  it("moves one edge: check-in or check-out", () => {
    expect(draggedStay(stay, "start", "2026-07-10", "2026-07-08")).toEqual({
      checkIn: "2026-07-08",
      checkOut: "2026-07-15",
    });
    expect(draggedStay(stay, "end", "2026-07-15", "2026-07-17")).toEqual({
      checkIn: "2026-07-10",
      checkOut: "2026-07-17",
    });
  });

  it("is nothing when the day did not change, or no night would be left", () => {
    expect(draggedStay(stay, "move", "2026-07-12", "2026-07-12")).toBeNull();
    expect(draggedStay(stay, "start", "2026-07-10", "2026-07-15")).toBeNull();
    expect(draggedStay(stay, "end", "2026-07-15", "2026-07-10")).toBeNull();
    // A stay shortened to its last night is still a stay.
    expect(draggedStay(stay, "start", "2026-07-10", "2026-07-14")).toEqual({
      checkIn: "2026-07-14",
      checkOut: "2026-07-15",
    });
  });
});

describe("pastThreshold", () => {
  it("ignores a one-pixel slip", () => {
    expect(pastThreshold(1, 0)).toBe(false);
    expect(pastThreshold(3, 3)).toBe(false);
    expect(pastThreshold(6, 0)).toBe(true);
  });
});
