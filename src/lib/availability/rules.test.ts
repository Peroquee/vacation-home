import { describe, expect, it } from "vitest";

import {
  type BlockSpan,
  type BookingSpan,
  type BookingStatus,
  dailyAvailability,
  findConflicts,
  MAX_DAYS,
} from "@/lib/availability/rules";

// An existing confirmed stay, 14-18 July: the nights of 14, 15, 16 and 17.
const existing = (status: BookingStatus = "confirmed", id = "b1"): BookingSpan => ({
  id,
  status,
  start: "2026-07-14",
  end: "2026-07-18",
});
const block = (start: string, end: string, id = "k1"): BlockSpan => ({
  id,
  start,
  end,
  reason: "Painting",
  origin: "manual",
});
const conflictIds = (
  start: string,
  end: string,
  bookings: BookingSpan[],
  blocks: BlockSpan[] = [],
) => findConflicts({ start, end }, bookings, blocks).map((c) => `${c.kind}:${c.id}`);

describe("findConflicts: against a confirmed booking", () => {
  const bookings = [existing()];

  it("exact overlap conflicts", () => {
    expect(conflictIds("2026-07-14", "2026-07-18", bookings)).toEqual(["booking:b1"]);
  });

  it("partial overlap at the start conflicts", () => {
    expect(conflictIds("2026-07-10", "2026-07-15", bookings)).toEqual(["booking:b1"]);
  });

  it("partial overlap at the end conflicts", () => {
    expect(conflictIds("2026-07-17", "2026-07-21", bookings)).toEqual(["booking:b1"]);
  });

  it("a range fully contained in the stay conflicts", () => {
    expect(conflictIds("2026-07-15", "2026-07-16", bookings)).toEqual(["booking:b1"]);
  });

  it("a range fully containing the stay conflicts", () => {
    expect(conflictIds("2026-07-01", "2026-07-31", bookings)).toEqual(["booking:b1"]);
  });

  it("a single night on the stay's last night conflicts", () => {
    expect(conflictIds("2026-07-17", "2026-07-18", bookings)).toEqual(["booking:b1"]);
  });

  it("same-day turnover is allowed: arriving on the departure day", () => {
    expect(conflictIds("2026-07-18", "2026-07-20", bookings)).toEqual([]);
  });

  it("same-day turnover is allowed: leaving on the arrival day", () => {
    expect(conflictIds("2026-07-10", "2026-07-14", bookings)).toEqual([]);
  });

  it("ranges well apart are allowed", () => {
    expect(conflictIds("2026-08-01", "2026-08-05", bookings)).toEqual([]);
  });

  it("filling exactly the gap between two stays is allowed", () => {
    const two = [
      existing(),
      { ...existing("confirmed", "b2"), start: "2026-07-20", end: "2026-07-25" },
    ];
    expect(conflictIds("2026-07-18", "2026-07-20", two)).toEqual([]);
    expect(conflictIds("2026-07-17", "2026-07-21", two)).toEqual(["booking:b1", "booking:b2"]);
  });
});

describe("findConflicts: booking statuses", () => {
  it("a cancelled booking is ignored", () => {
    expect(conflictIds("2026-07-14", "2026-07-18", [existing("cancelled")])).toEqual([]);
  });

  it("an inquiry does not block", () => {
    expect(conflictIds("2026-07-14", "2026-07-18", [existing("inquiry")])).toEqual([]);
  });

  it("the booking being moved is ignored, others still count", () => {
    const bookings = [
      existing(),
      { ...existing("confirmed", "b2"), start: "2026-07-20", end: "2026-07-22" },
    ];
    const moved = findConflicts({ start: "2026-07-15", end: "2026-07-19" }, bookings, [], {
      ignoreBookingId: "b1",
    });
    expect(moved).toEqual([]);
    const intoOther = findConflicts({ start: "2026-07-15", end: "2026-07-21" }, bookings, [], {
      ignoreBookingId: "b1",
    });
    expect(intoOther.map((c) => c.id)).toEqual(["b2"]);
  });
});

describe("findConflicts: blocks", () => {
  it("a block blocks exactly like a confirmed booking", () => {
    const blocks = [block("2026-07-14", "2026-07-18")];
    expect(conflictIds("2026-07-14", "2026-07-18", [], blocks)).toEqual(["block:k1"]);
    expect(conflictIds("2026-07-10", "2026-07-15", [], blocks)).toEqual(["block:k1"]);
    expect(conflictIds("2026-07-17", "2026-07-21", [], blocks)).toEqual(["block:k1"]);
    expect(conflictIds("2026-07-15", "2026-07-16", [], blocks)).toEqual(["block:k1"]);
    expect(conflictIds("2026-07-18", "2026-07-20", [], blocks)).toEqual([]);
    expect(conflictIds("2026-07-10", "2026-07-14", [], blocks)).toEqual([]);
  });

  it("bookings and blocks are reported together, in date order, with block details", () => {
    const conflicts = findConflicts(
      { start: "2026-07-01", end: "2026-07-31" },
      [existing()],
      [block("2026-07-02", "2026-07-04", "early"), block("2026-07-25", "2026-07-26", "late")],
    );
    expect(conflicts.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "block:early",
      "booking:b1",
      "block:late",
    ]);
    expect(conflicts[0]).toMatchObject({ reason: "Painting", origin: "manual" });
  });

  it("a stay may start the day a block ends, and end the day one starts", () => {
    const blocks = [
      block("2026-07-10", "2026-07-14", "before"),
      block("2026-07-18", "2026-07-20", "after"),
    ];
    expect(conflictIds("2026-07-14", "2026-07-18", [], blocks)).toEqual([]);
  });
});

describe("findConflicts: dates", () => {
  it("handles month, year and leap-day boundaries", () => {
    const bookings = [{ ...existing(), start: "2026-12-30", end: "2027-01-02" }];
    expect(conflictIds("2027-01-01", "2027-01-03", bookings)).toEqual(["booking:b1"]);
    expect(conflictIds("2027-01-02", "2027-01-03", bookings)).toEqual([]);

    const leap = [{ ...existing(), start: "2028-02-28", end: "2028-03-01" }];
    expect(conflictIds("2028-02-29", "2028-03-02", leap)).toEqual(["booking:b1"]);
    expect(conflictIds("2028-03-01", "2028-03-02", leap)).toEqual([]);
  });

  it("is unaffected by daylight-saving changes: dates carry no time of day", () => {
    // Clocks change in Europe on 29 March and 25 October 2026.
    const bookings = [{ ...existing(), start: "2026-03-28", end: "2026-03-30" }];
    expect(conflictIds("2026-03-29", "2026-03-30", bookings)).toEqual(["booking:b1"]);
    expect(conflictIds("2026-03-30", "2026-04-01", bookings)).toEqual([]);
  });

  it("refuses an empty, inverted or malformed range", () => {
    expect(() => findConflicts({ start: "2026-07-14", end: "2026-07-14" }, [], [])).toThrow(
      RangeError,
    );
    expect(() => findConflicts({ start: "2026-07-18", end: "2026-07-14" }, [], [])).toThrow(
      RangeError,
    );
    expect(() => findConflicts({ start: "2026-7-14", end: "2026-07-18" }, [], [])).toThrow(
      RangeError,
    );
  });
});

describe("dailyAvailability", () => {
  it("lays out each night with its status and turnover markers", () => {
    const days = dailyAvailability(
      { start: "2026-07-12", end: "2026-07-22" },
      [
        existing(),
        { id: "q1", status: "inquiry", start: "2026-07-18", end: "2026-07-20" },
        { id: "x1", status: "cancelled", start: "2026-07-12", end: "2026-07-14" },
      ],
      [block("2026-07-20", "2026-07-21")],
    );

    expect(days.map((d) => `${d.date.slice(8)}:${d.status}`)).toEqual([
      "12:available", // the cancelled stay is gone
      "13:available",
      "14:booked",
      "15:booked",
      "16:booked",
      "17:booked",
      "18:inquiry", // free night, held tentatively
      "19:inquiry",
      "20:blocked",
      "21:available",
    ]);
    const byDate = Object.fromEntries(days.map((d) => [d.date.slice(8), d]));
    expect(byDate["14"]).toMatchObject({ checkIn: true, checkOut: false, bookingId: "b1" });
    expect(byDate["18"]).toMatchObject({ checkIn: false, checkOut: true, inquiryIds: ["q1"] });
    expect(byDate["20"]!.blockIds).toEqual(["k1"]);
  });

  it("shows a confirmed booking over a block on the same night", () => {
    const [day] = dailyAvailability(
      { start: "2026-07-14", end: "2026-07-15" },
      [existing()],
      [block("2026-07-14", "2026-07-15")],
    );
    expect(day).toMatchObject({ status: "booked", bookingId: "b1", blockIds: ["k1"] });
  });

  it("marks a same-day turnover as both a check-out and a check-in", () => {
    const days = dailyAvailability(
      { start: "2026-07-18", end: "2026-07-19" },
      [existing(), { id: "b2", status: "confirmed", start: "2026-07-18", end: "2026-07-20" }],
      [],
    );
    expect(days[0]).toMatchObject({
      status: "booked",
      bookingId: "b2",
      checkIn: true,
      checkOut: true,
    });
  });

  it("covers month and year ends one night at a time", () => {
    const days = dailyAvailability({ start: "2026-12-30", end: "2027-01-02" }, [], []);
    expect(days.map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("refuses a range that is empty or too long", () => {
    expect(() => dailyAvailability({ start: "2026-07-14", end: "2026-07-14" }, [], [])).toThrow(
      RangeError,
    );
    expect(() => dailyAvailability({ start: "2026-01-01", end: "2030-01-01" }, [], [])).toThrow(
      new RegExp(`at most ${MAX_DAYS}`),
    );
  });
});
