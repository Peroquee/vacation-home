import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { calculateTotalMinor, MAX_AMOUNT_MINOR } from "@/lib/bookings/pricing";
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

let propertyId: string;
let guestId: string;

beforeAll(async () => {
  propertyId = (
    await db.property.create({
      data: { name: "Lake House", timezone: "Europe/Lisbon", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  guestId = (await db.guest.create({ data: { name: "Ada Lovelace" } })).id;
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.$disconnect();
});

function booking(overrides: Partial<Prisma.BookingUncheckedCreateInput> = {}) {
  return db.booking.create({
    data: {
      propertyId,
      guestId,
      checkIn: toUtcDate("2026-07-14"),
      checkOut: toUtcDate("2026-07-18"),
      nightlyRateMinor: 0,
      cleaningFeeMinor: 0,
      totalAmountMinor: 0,
      currency: "EUR",
      ...overrides,
    },
  });
}

describe("booking money", () => {
  it("round-trips every amount exactly, up to the column's limit", async () => {
    for (const amount of [0, 1, 99, 1999, 10_101, 123_456_789, MAX_AMOUNT_MINOR]) {
      const created = await booking({
        nightlyRateMinor: amount,
        cleaningFeeMinor: amount,
        totalAmountMinor: amount,
      });
      const read = await db.booking.findUniqueOrThrow({ where: { id: created.id } });
      expect([read.nightlyRateMinor, read.cleaningFeeMinor, read.totalAmountMinor]).toEqual([
        amount,
        amount,
        amount,
      ]);
    }
  });

  it("stores a calculated total exactly as calculated", async () => {
    const stay = { checkIn: "2026-07-14", checkOut: "2026-07-18" };
    const total = calculateTotalMinor({
      ...stay,
      nightlyRateMinor: 18_999,
      cleaningFeeMinor: 6_001,
    });
    const created = await booking({
      nightlyRateMinor: 18_999,
      cleaningFeeMinor: 6_001,
      totalAmountMinor: total,
    });
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: created.id } })).totalAmountMinor,
    ).toBe(81_997); // 4 nights x 18,999 + 6,001
  });

  it("refuses amounts the column cannot hold, rather than wrapping them", async () => {
    await expect(booking({ totalAmountMinor: MAX_AMOUNT_MINOR + 1 })).rejects.toMatchObject({
      code: "P2020",
      message: expect.stringMatching(/out of range for type integer/),
    });
  });

  it("refuses negative amounts", async () => {
    await expect(booking({ cleaningFeeMinor: -1 })).rejects.toThrow(
      /bookings_cleaning_fee_non_negative/,
    );
  });
});

describe("booking dates", () => {
  it("round-trip as calendar dates, whatever the process timezone", async () => {
    // This suite runs at UTC+14 (see vitest.db.config.mts).
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-14 * 60);

    for (const [checkIn, checkOut] of [
      ["2026-03-28", "2026-03-30"],
      ["2026-10-24", "2026-10-26"],
      ["2026-12-31", "2027-01-01"],
      ["2028-02-28", "2028-03-01"],
    ]) {
      const created = await booking({
        checkIn: toUtcDate(checkIn!),
        checkOut: toUtcDate(checkOut!),
      });
      const read = await db.booking.findUniqueOrThrow({ where: { id: created.id } });
      expect([fromUtcDate(read.checkIn), fromUtcDate(read.checkOut)]).toEqual([checkIn, checkOut]);
    }
  });

  it("refuse a check-out that is not after the check-in", async () => {
    await expect(
      booking({ checkIn: toUtcDate("2026-07-14"), checkOut: toUtcDate("2026-07-14") }),
    ).rejects.toThrow(/bookings_check_out_after_check_in/);
  });

  it("are stored as the 'booking.com' source the API speaks", async () => {
    const created = await booking({ source: "booking_com" });
    const [row] = await db.$queryRaw<{ source: string }[]>`
      SELECT source::text FROM bookings WHERE id = ${created.id}::uuid`;
    expect(row!.source).toBe("booking.com");
  });
});

describe("relations", () => {
  it("refuse deleting a property or guest that has bookings", async () => {
    await booking();
    await expect(db.property.delete({ where: { id: propertyId } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(db.guest.delete({ where: { id: guestId } })).rejects.toMatchObject({
      code: "P2003",
    });
  });
});
