import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { checkStayAt, getBookingRules, saveBookingRules } from "./service";

let property: { id: string; timezone: string };
let guestId: string;
// Noon UTC on 2026-07-01: still 2026-07-01 in Berlin.
const NOW = new Date("2026-07-01T12:00:00Z");

const rules = {
  minNights: 1,
  maxNights: null,
  minLeadDays: 0,
  horizonDays: null,
  checkInWeekdays: [],
  bufferDays: 2,
};

function booking(checkIn: string, checkOut: string, status: "confirmed" | "inquiry" | "cancelled") {
  return db.booking.create({
    data: {
      propertyId: property.id,
      guestId,
      checkIn: toUtcDate(checkIn),
      checkOut: toUtcDate(checkOut),
      status,
      nightlyRateMinor: 10_000,
      cleaningFeeMinor: 0,
      totalAmountMinor: 10_000,
      currency: "EUR",
    },
  });
}

const check = (checkIn: string, checkOut: string, options: { ignoreBookingId?: string } = {}) =>
  checkStayAt(property, { checkIn, checkOut }, { mode: "public", now: NOW, ...options }).then(
    (violations) => violations.map((v) => `${v.field}: ${v.rule}`),
  );

beforeAll(async () => {
  property = await db.property.create({
    data: { name: "Lake House", timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
  });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.bookingRules.deleteMany();
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.bookingRules.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  await db.$disconnect();
});

describe("booking rules storage", () => {
  it("allows anything until the owner sets rules, then keeps them", async () => {
    expect(await getBookingRules(property.id)).toMatchObject({ minNights: 1, bufferDays: 0 });
    await saveBookingRules(property.id, { ...rules, checkInWeekdays: [3, 6] });
    expect(await getBookingRules(property.id)).toMatchObject({
      checkInWeekdays: [3, 6],
      bufferDays: 2,
    });
  });

  it("is held to its bounds by the database too", async () => {
    await expect(
      db.bookingRules.create({ data: { propertyId: property.id, minNights: 3, maxNights: 2 } }),
    ).rejects.toThrow(/booking_rules_max_nights/);
    await expect(
      db.bookingRules.create({ data: { propertyId: property.id, checkInWeekdays: [0] } }),
    ).rejects.toThrow(/booking_rules_weekdays/);
  });
});

describe("checkStayAt", () => {
  beforeEach(async () => {
    await saveBookingRules(property.id, rules);
  });

  it("keeps the buffer days next to confirmed bookings", async () => {
    await booking("2026-07-05", "2026-07-10", "confirmed");
    expect(await check("2026-07-11", "2026-07-14")).toEqual(["checkIn: bufferDays"]);
    expect(await check("2026-07-12", "2026-07-14")).toEqual([]);
    expect(await check("2026-07-01", "2026-07-04")).toEqual(["checkOut: bufferDays"]);
    expect(await check("2026-07-01", "2026-07-03")).toEqual([]);
  });

  it("keeps the buffer days next to blocks", async () => {
    await db.block.create({
      data: {
        propertyId: property.id,
        startDate: toUtcDate("2026-07-20"),
        endDate: toUtcDate("2026-07-25"),
      },
    });
    expect(await check("2026-07-15", "2026-07-19")).toEqual(["checkOut: bufferDays"]);
    expect(await check("2026-07-26", "2026-07-28")).toEqual(["checkIn: bufferDays"]);
    expect(await check("2026-07-27", "2026-07-28")).toEqual([]);
    expect(await check("2026-07-22", "2026-07-28")).toEqual(["checkIn: unavailable"]);
  });

  it("ignores inquiries, cancelled bookings, and the booking being edited", async () => {
    await booking("2026-07-05", "2026-07-10", "inquiry");
    await booking("2026-07-05", "2026-07-10", "cancelled");
    expect(await check("2026-07-06", "2026-07-08")).toEqual([]);
    const own = await booking("2026-07-12", "2026-07-15", "confirmed");
    expect(await check("2026-07-13", "2026-07-16", { ignoreBookingId: own.id })).toEqual([]);
    expect(await check("2026-07-13", "2026-07-16")).toEqual(["checkIn: unavailable"]);
  });

  it("counts today in the property's timezone", async () => {
    await saveBookingRules(property.id, { ...rules, bufferDays: 0, minLeadDays: 1 });
    // 23:30 UTC on 30 June is already 1 July in Berlin.
    const late = new Date("2026-06-30T23:30:00Z");
    const violations = await checkStayAt(
      property,
      { checkIn: "2026-07-01", checkOut: "2026-07-03" },
      { mode: "public", now: late },
    );
    expect(violations.map((v) => v.rule)).toEqual(["minLeadDays"]);
    expect(
      await checkStayAt(
        property,
        { checkIn: "2026-07-02", checkOut: "2026-07-03" },
        { mode: "public", now: late },
      ),
    ).toEqual([]);
  });
});
