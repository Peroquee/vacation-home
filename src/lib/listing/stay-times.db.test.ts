/**
 * Arrival and departure times against a real PostgreSQL (GitLab #126): the
 * migration keeps the existing times and gives the bookings already
 * reserved theirs, the API checks each field, and a booking keeps the
 * times it was reserved or made under.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET, PUT } from "@/app/api/properties/[id]/stay-times/route";
import { Prisma, type Property } from "@/generated/prisma/client";
import { reserveBooking } from "@/lib/bookings/hold";
import { createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { issueGuestToken } from "@/lib/payments/guest-link";
import { guestView } from "@/lib/payments/guest-view";

import { listingSchema } from "./schema";
import { bookingStayTimes, getStayTimes, saveListing, saveStayTimes } from "./service";

let property: Property;
let guestId: string;
const NOW = new Date("2026-07-01T12:00:00Z");
const TIMES = { checkInTime: "15:00", earliestCheckOutTime: "08:00", checkOutTime: "10:00" };

/** A property that does not exist. */
const ctx = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) };
const put = (body: unknown) =>
  PUT(
    new Request("http://test/api", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: property.id }) },
  );

async function booking(status: "inquiry" | "confirmed", checkIn = "2026-09-10") {
  const made = await createBooking({
    propertyId: property.id,
    guestId,
    checkIn,
    checkOut: checkIn.replace(/-10$/, "-14"),
    status,
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in made)) throw new Error(JSON.stringify(made));
  return made.booking;
}

beforeAll(async () => {
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "Europe/Berlin",
      currency: "EUR",
      color: "#0f766e",
      defaultNightlyRateMinor: 10_000,
    },
  });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.bookingPayment.deleteMany();
  await db.bookingEvent.deleteMany();
  await db.booking.deleteMany();
  await db.propertyListing.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the migration", () => {
  it("keeps the times there were, and gives the bookings already reserved theirs", async () => {
    // As before it: a listing with check-in and check-out times, a
    // reservation and a confirmed booking without times, and a request.
    await db.propertyListing.create({
      data: { propertyId: property.id, checkInTime: "16:00", checkOutTime: "11:00" },
    });
    const reserved = await booking("inquiry", "2026-09-10");
    await reserveBooking(reserved.id, NOW);
    const confirmed = await booking("confirmed", "2026-10-10");
    const request = await booking("inquiry", "2026-11-10");
    await db.booking.updateMany({ data: { stayTimes: Prisma.DbNull } });

    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261023010000_stay_times/migration.sql"),
      "utf8",
    );
    const backfill = sql.slice(sql.indexOf("-- backfill"));
    expect(backfill).toMatch(/^-- backfill[\s\S]*UPDATE "bookings"/);
    await db.$executeRawUnsafe(backfill);
    // Twice changes nothing.
    await db.$executeRawUnsafe(backfill);

    // The existing values carry over unchanged: earliest arrival and latest departure.
    expect(await getStayTimes(property.id)).toEqual({
      checkInTime: "16:00",
      earliestCheckOutTime: null,
      checkOutTime: "11:00",
    });
    const stored = async (id: string) =>
      (await db.booking.findUniqueOrThrow({ where: { id } })).stayTimes;
    const was = { checkInTime: "16:00", earliestCheckOutTime: null, checkOutTime: "11:00" };
    expect(await stored(reserved.id)).toEqual(was);
    expect(await stored(confirmed.id)).toEqual(was);
    expect(await stored(request.id)).toBeNull();
  });
});

describe("the API", () => {
  it("is unset until saved, then holds all three", async () => {
    const empty = await GET(new Request("http://test/api"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(await empty.json()).toEqual({
      checkInTime: null,
      earliestCheckOutTime: null,
      checkOutTime: null,
    });
    const saved = await put(TIMES);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(TIMES);
  });

  it("refuses invalid times and an earliest departure after the latest, per field", async () => {
    const bad = await put({ checkInTime: "25:00", earliestCheckOutTime: "8", checkOutTime: "" });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual([
      "checkInTime",
      "earliestCheckOutTime",
    ]);
    const order = await put({ earliestCheckOutTime: "11:00", checkOutTime: "10:00" });
    expect(order.status).toBe(422);
    expect((await order.json()).error.fields).toEqual({
      earliestCheckOutTime: ["must not be later than the latest departure"],
    });
    expect(await getStayTimes(property.id)).toEqual({
      checkInTime: null,
      earliestCheckOutTime: null,
      checkOutTime: null,
    });
  });

  it("is a 404 for an unknown property", async () => {
    expect((await GET(new Request("http://test/api"), ctx)).status).toBe(404);
  });

  it("leaves the rest of the profile alone, and the profile leaves the times", async () => {
    await saveListing(property.id, listingSchema.parse({ titleEn: "Lake house" }));
    await saveStayTimes(property.id, TIMES);
    await saveListing(property.id, listingSchema.parse({ titleEn: "Lake house, renamed" }));
    expect(await getStayTimes(property.id)).toEqual(TIMES);
    expect(listingSchema.safeParse({ checkInTime: "15:00" }).success).toBe(false);
  });

  it("is held to its order by the database too", async () => {
    await expect(
      db.propertyListing.create({
        data: { propertyId: property.id, earliestCheckOutTime: "11:00", checkOutTime: "10:00" },
      }),
    ).rejects.toThrow(/property_listings_departure_order/);
  });
});

describe("a booking", () => {
  it("keeps the times it was reserved under when the property's change", async () => {
    await saveStayTimes(property.id, TIMES);
    const request = await booking("inquiry");
    // A request has none yet: the property's apply.
    expect(request.stayTimes).toBeNull();
    const reserved = await reserveBooking(request.id, NOW);
    if (!("booking" in reserved)) throw new Error(JSON.stringify(reserved));
    expect(reserved.booking.stayTimes).toEqual(TIMES);

    const later = { checkInTime: "17:00", earliestCheckOutTime: null, checkOutTime: "09:00" };
    await saveStayTimes(property.id, later);
    expect(await bookingStayTimes(reserved.booking)).toEqual(TIMES);
    const view = await guestView(await issueGuestToken(request.id));
    expect(view?.times).toEqual(TIMES);
    // A request made now has the new ones until it is reserved.
    expect(await bookingStayTimes(await booking("inquiry", "2026-10-10"))).toEqual(later);
  });

  it("made by the owner keeps the times it was made under", async () => {
    await saveStayTimes(property.id, TIMES);
    const made = await booking("confirmed");
    expect(made.stayTimes).toEqual(TIMES);
    await saveStayTimes(property.id, { ...TIMES, checkInTime: "18:00" });
    expect(await bookingStayTimes(made)).toEqual(TIMES);
  });
});
