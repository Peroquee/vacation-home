import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { listBookingsSchema } from "./schema";
import { listBookings } from "./service";

const ids = { properties: [] as string[], guests: [] as string[] };

/** Bookings named by their notes, so a listing reads as a list of names. */
async function setUp() {
  const property = (name: string) =>
    db.property
      .create({ data: { name, timezone: "Europe/Lisbon", currency: "EUR", color: "#0f766e" } })
      .then((p) => (ids.properties.push(p.id), p.id));
  const guest = (name: string) =>
    db.guest.create({ data: { name } }).then((g) => (ids.guests.push(g.id), g.id));
  // Names no other test uses, so `q` can single these bookings out.
  const [lake, sea] = await Promise.all([property("Sorting Lake"), property("Sorting Sea")]);
  const [ada, grace] = await Promise.all([guest("Sortest Ada"), guest("Sortest Grace")]);
  const booking = (
    notes: string,
    data: Partial<Prisma.BookingUncheckedCreateInput> & { checkIn: string; checkOut: string },
  ) =>
    db.booking.create({
      data: {
        propertyId: lake,
        guestId: ada,
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
        ...data,
        checkIn: toUtcDate(data.checkIn),
        checkOut: toUtcDate(data.checkOut),
        notes,
      },
    });
  // One after another, so creation order breaks ties predictably.
  await booking("A", { checkIn: "2026-07-01", checkOut: "2026-07-03", totalAmountMinor: 300 });
  await booking("B", {
    checkIn: "2026-07-05",
    checkOut: "2026-07-07",
    propertyId: sea,
    guestId: grace,
    status: "confirmed",
    source: "airbnb",
    totalAmountMinor: 100,
  });
  await booking("C", { checkIn: "2026-07-09", checkOut: "2026-07-11", totalAmountMinor: 200 });
}

beforeAll(setUp);

afterAll(async () => {
  await db.booking.deleteMany({ where: { propertyId: { in: ids.properties } } });
  await db.guest.deleteMany({ where: { id: { in: ids.guests } } });
  await db.property.deleteMany({ where: { id: { in: ids.properties } } });
  await db.$disconnect();
});

async function order(sort: string) {
  const { items } = await listBookings(listBookingsSchema.parse({ sort, q: "Sortest" }));
  return items.map((b) => b.notes);
}

describe("listBookings sort", () => {
  it.each([
    ["checkIn", ["A", "B", "C"]],
    ["-checkIn", ["C", "B", "A"]],
    ["total", ["B", "C", "A"]],
    ["-total", ["A", "C", "B"]],
    // Ties (Ada has A and C) fall back to check-in. Enums sort in their
    // declared order: inquiry before confirmed, direct before airbnb.
    ["guest", ["A", "C", "B"]],
    ["-guest", ["B", "A", "C"]],
    ["property", ["A", "C", "B"]],
    ["-property", ["B", "A", "C"]],
    ["status", ["A", "C", "B"]],
    ["source", ["A", "C", "B"]],
    ["-source", ["B", "A", "C"]],
  ])("sorts by %s", async (sort, expected) => {
    expect(await order(sort)).toEqual(expected);
  });
});
