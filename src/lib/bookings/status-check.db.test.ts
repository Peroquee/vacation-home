import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { findStatusProblems } from "./status-check";

let propertyId: string;
let guestId: string;

/** A booking written straight into the table, as older status edits left them. */
async function stored(data: Partial<Prisma.BookingUncheckedCreateInput>) {
  const checkIn = new Date(Date.UTC(2027, 0, 1 + (await db.booking.count()) * 10));
  return db.booking.create({
    data: {
      propertyId,
      guestId,
      checkIn,
      checkOut: new Date(checkIn.getTime() + 3 * 86_400_000),
      status: "inquiry",
      source: "direct",
      guestCount: 2,
      cleaningFeeMinor: 0,
      totalAmountMinor: 100_000,
      currency: "EUR",
      ...data,
    },
  });
}

beforeAll(async () => {
  propertyId = (
    await db.property.create({
      data: { name: "Lake House", timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.bookingPayment.deleteMany();
  await db.booking.deleteMany();
});

describe("the status check (GitLab #135)", () => {
  it("finds nothing in bookings that agree with their status", async () => {
    await stored({ status: "confirmed", source: "airbnb" });
    await stored({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: "owner",
      refundDueMinor: 0,
    });
    expect(await findStatusProblems()).toEqual([]);
  });

  it("lists each kind of disagreement, and changes nothing", async () => {
    const cancelled = await stored({ status: "cancelled" });
    const revived = await stored({
      status: "confirmed",
      cancelledAt: new Date(),
      cancelledBy: "owner",
      refundDueMinor: 0,
    });
    const website = await stored({
      status: "confirmed",
      source: "website",
      reference: "ABCD2345",
      privacyConsentAt: new Date(),
    });
    const before = await db.booking.findMany({ orderBy: { id: "asc" } });

    expect(await findStatusProblems()).toEqual([
      { bookingId: cancelled.id, status: "cancelled", problem: "cancelled_without_cancellation" },
      { bookingId: revived.id, status: "confirmed", problem: "cancellation_on_active_booking" },
      { bookingId: website.id, status: "confirmed", problem: "website_booking_not_paid_enough" },
    ]);
    expect(await db.booking.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});
