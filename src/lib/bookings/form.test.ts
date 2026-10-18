import { describe, expect, it } from "vitest";

import type { CalendarBlock, CalendarBooking } from "@/lib/availability/calendar";

import { previewPrice, stayConflicts, stayNights, toPropertyChoice, turnoverFix } from "./form";

function booking(over: Partial<CalendarBooking>): CalendarBooking {
  return {
    id: "b1",
    checkIn: "2026-07-14",
    checkOut: "2026-07-18",
    status: "confirmed",
    source: "direct",
    guest: { id: "g1", name: "Ada Lovelace" },
    ...over,
  };
}

function block(over: Partial<CalendarBlock>): CalendarBlock {
  return {
    id: "k1",
    startDate: "2026-07-20",
    endDate: "2026-07-22",
    reason: null,
    origin: "manual",
    ...over,
  };
}

describe("stayNights", () => {
  it("counts nights between valid dates", () => {
    expect(stayNights("2026-07-14", "2026-07-18")).toBe(4);
  });

  it("is null while the stay is incomplete or invalid", () => {
    expect(stayNights("", "2026-07-18")).toBeNull();
    expect(stayNights("2026-07-18", "2026-07-18")).toBeNull();
    expect(stayNights("2026-07-18", "2026-07-14")).toBeNull();
    expect(stayNights("2026-01-01", "2027-01-03")).toBeNull(); // over 365 nights
  });
});

describe("previewPrice", () => {
  const { pricing } = toPropertyChoice({
    id: "p",
    name: "Lake",
    currency: "EUR",
    defaultNightlyRateMinor: 18000,
    defaultCleaningFeeMinor: 6000,
  });

  it("is the engine's price: nights x rate + cleaning fee without seasons", () => {
    const stay = { checkIn: "2026-07-14", checkOut: "2026-07-18" };
    expect(
      previewPrice(pricing, { ...stay, nightlyRateMinor: null, cleaningFeeMinor: 6000 })
        ?.totalMinor,
    ).toBe(78000);
    expect(
      previewPrice(pricing, { ...stay, nightlyRateMinor: 10000, cleaningFeeMinor: 0 })?.totalMinor,
    ).toBe(40000);
  });

  it("is null while something is missing or the stay is none", () => {
    const stay = { checkIn: "2026-07-14", checkOut: "2026-07-18", nightlyRateMinor: null };
    expect(previewPrice(pricing, { ...stay, cleaningFeeMinor: null })).toBeNull();
    expect(previewPrice(pricing, { ...stay, checkOut: "", cleaningFeeMinor: 0 })).toBeNull();
    expect(
      previewPrice(pricing, { ...stay, checkOut: "2026-07-14", cleaningFeeMinor: 0 }),
    ).toBeNull();
  });
});

describe("stayConflicts", () => {
  const stay = { checkIn: "2026-07-16", checkOut: "2026-07-21" };

  it("finds overlapping confirmed bookings and blocks", () => {
    const conflicts = stayConflicts(stay, { bookings: [booking({})], blocks: [block({})] });
    expect(conflicts.map((c) => [c.kind, c.id])).toEqual([
      ["booking", "b1"],
      ["block", "k1"],
    ]);
  });

  it("ignores inquiries, touching stays and the booking being edited", () => {
    const calendar = {
      bookings: [
        booking({ id: "inquiry", status: "inquiry" }),
        booking({ id: "before", checkIn: "2026-07-10", checkOut: "2026-07-16" }),
        booking({ id: "self" }),
      ],
      blocks: [block({ startDate: "2026-07-21", endDate: "2026-07-23" })],
    };
    expect(stayConflicts(stay, calendar, "self")).toEqual([]);
  });

  it("finds nothing while the dates are incomplete", () => {
    expect(
      stayConflicts(
        { checkIn: "2026-07-16", checkOut: "" },
        { bookings: [booking({})], blocks: [] },
      ),
    ).toEqual([]);
  });
});

describe("turnoverFix", () => {
  const ada = { kind: "booking", id: "b1", start: "2026-07-10", end: "2026-07-15" } as const;

  it("suggests arriving on the day the previous stay leaves", () => {
    // Arriving the 14th overlaps Ada's last night; the 15th is free.
    expect(turnoverFix({ checkIn: "2026-07-14", checkOut: "2026-07-18" }, ada)).toEqual({
      move: "checkIn",
      to: "2026-07-15",
    });
  });

  it("suggests leaving on the day the next stay arrives", () => {
    expect(turnoverFix({ checkIn: "2026-07-07", checkOut: "2026-07-11" }, ada)).toEqual({
      move: "checkOut",
      to: "2026-07-10",
    });
  });

  it("stays out of overlaps that are not one night off a changeover", () => {
    expect(turnoverFix({ checkIn: "2026-07-12", checkOut: "2026-07-18" }, ada)).toBeNull();
    expect(turnoverFix({ checkIn: "2026-07-11", checkOut: "2026-07-13" }, ada)).toBeNull();
    expect(turnoverFix({ checkIn: "2026-07-08", checkOut: "2026-07-20" }, ada)).toBeNull();
  });
});
