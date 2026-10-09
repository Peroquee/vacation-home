import { describe, expect, it } from "vitest";

import { agendaItems, monthWindow } from "./agenda";

const lake = { id: "p1", name: "Lake House", color: "#2a78d6" };
const sea = { id: "p2", name: "Sea View", color: "#eb6834" };
const booking = (id: string, checkIn: string, checkOut: string) => ({
  id,
  checkIn,
  checkOut,
  status: "confirmed" as const,
  source: "direct",
  guest: { id: `g-${id}`, name: id },
});

describe("agenda", () => {
  it("covers a month as [first, next first)", () => {
    expect(monthWindow("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("lists a month's stays and blocks in date order across properties", () => {
    const items = agendaItems("2026-07", [
      {
        property: lake,
        bookings: [
          booking("late", "2026-07-20", "2026-07-24"),
          booking("june", "2026-06-10", "2026-06-12"),
        ],
        blocks: [
          {
            id: "k1",
            startDate: "2026-07-05",
            endDate: "2026-07-07",
            reason: null,
            origin: "manual",
          },
        ],
      },
      { property: sea, bookings: [booking("same-day", "2026-07-20", "2026-07-22")], blocks: [] },
    ]);
    expect(items.map((i) => [i.kind, i.id, i.property.id])).toEqual([
      ["block", "k1", "p1"],
      ["booking", "late", "p1"],
      ["booking", "same-day", "p2"],
    ]);
  });

  it("shows a stay crossing months in each, but not a stay ending on the 1st", () => {
    const calendars = [
      {
        property: lake,
        bookings: [
          booking("across", "2026-07-30", "2026-08-03"),
          booking("ends", "2026-06-28", "2026-07-01"),
        ],
        blocks: [],
      },
    ];
    expect(agendaItems("2026-07", calendars).map((i) => i.id)).toEqual(["across"]);
    expect(agendaItems("2026-08", calendars).map((i) => i.id)).toEqual(["across"]);
  });
});
