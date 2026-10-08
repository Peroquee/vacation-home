import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { PURGED_GUEST_NAME, purgeGuest } from "./purge";
import { parseIdsFile, repurgeGuests } from "./repurge";

let propertyId: string;

async function guestWithBooking() {
  const guest = await db.guest.create({
    data: {
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+44 20 7946 0000",
      notes: "VIP",
    },
  });
  const booking = await db.booking.create({
    data: {
      propertyId,
      guestId: guest.id,
      checkIn: toUtcDate("2026-11-01"),
      checkOut: toUtcDate("2026-11-04"),
      status: "confirmed",
      nightlyRateMinor: 10_000,
      cleaningFeeMinor: 5_000,
      totalAmountMinor: 35_000,
      currency: "EUR",
      notes: "Arrives late",
    },
  });
  return { guest, booking };
}

/** What a restore of a backup taken before the erasure does to the guest. */
async function restoreEarlierCopy(guest: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}) {
  await db.guest.upsert({
    where: { id: guest.id },
    create: { ...guest, purgedAt: null },
    update: {
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      notes: guest.notes,
      purgedAt: null,
    },
  });
}

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany({ where: { name: "Repurge house" } });
  propertyId = (
    await db.property.create({
      data: { name: "Repurge house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("repurgeGuests", () => {
  it("erases a guest a restore brought back, leaving the bookings, and is harmless twice", async () => {
    const { guest, booking } = await guestWithBooking();
    await purgeGuest(guest.id, null);
    await restoreEarlierCopy(guest);
    await db.booking.update({ where: { id: booking.id }, data: { notes: "Arrives late" } });

    expect(await repurgeGuests([guest.id])).toEqual({ purged: 1, alreadyPurged: 0, notFound: 0 });

    const erased = await db.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(erased).toMatchObject({
      name: PURGED_GUEST_NAME,
      email: null,
      phone: null,
      notes: null,
    });
    expect(erased.purgedAt).not.toBeNull();
    const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // The booking stays, amounts and dates untouched; only its free text goes.
    expect({ ...after, notes: "Arrives late", updatedAt: booking.updatedAt }).toEqual(booking);
    expect(after.notes).toBeNull();

    expect(await repurgeGuests([guest.id])).toEqual({ purged: 0, alreadyPurged: 1, notFound: 0 });
    expect(await db.booking.count()).toBe(1);
  });

  it("deletes again a guest without bookings that came back", async () => {
    const guest = await db.guest.create({
      data: { name: "Grace Hopper", email: "grace@example.test" },
    });
    await purgeGuest(guest.id, null);
    await restoreEarlierCopy(guest);

    expect(await repurgeGuests([guest.id])).toEqual({ purged: 1, alreadyPurged: 0, notFound: 0 });
    expect(await db.guest.findUnique({ where: { id: guest.id } })).toBeNull();
    // Gone, with the deletion on record: a second run counts it as erased.
    expect(await repurgeGuests([guest.id])).toEqual({ purged: 0, alreadyPurged: 1, notFound: 0 });
  });

  it("counts ids this database never had as not found, and changes nothing else", async () => {
    const { guest } = await guestWithBooking();
    expect(await repurgeGuests([crypto.randomUUID()])).toEqual({
      purged: 0,
      alreadyPurged: 0,
      notFound: 1,
    });
    expect(await db.guest.findUniqueOrThrow({ where: { id: guest.id } })).toMatchObject({
      name: "Ada Lovelace",
      purgedAt: null,
    });
  });
});

describe("parseIdsFile", () => {
  it("reads one id per line, skipping blanks, comments and repeats", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(parseIdsFile(`${id}\n\n# saved by restore.sh\n${id.toUpperCase()}\r\n`)).toEqual({
      ids: [id],
      invalidLines: [],
    });
  });

  it("reports the line numbers of anything else, not their content", () => {
    expect(parseIdsFile("6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b\nAda Lovelace\nnot-a-uuid")).toEqual({
      ids: ["6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"],
      invalidLines: [2, 3],
    });
  });
});
