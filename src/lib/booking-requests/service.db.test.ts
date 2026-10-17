import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { saveBookingRules } from "@/lib/booking-rules/service";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { fillLegal } from "@/lib/legal/testing/complete-legal";
import { purgeGuest } from "@/lib/guests/purge";
import { EMPTY_LISTING, saveListing } from "@/lib/listing/service";

import type { BookingRequestInput } from "./schema";
import { createBookingRequest } from "./service";

let property: Property;
const NOW = new Date("2026-07-01T12:00:00Z");

function input(overrides: Partial<BookingRequestInput> = {}): BookingRequestInput {
  return {
    checkIn: "2026-08-10",
    checkOut: "2026-08-14",
    guestCount: 2,
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+49 30 1234",
    message: "We would love to come.",
    consent: true,
    locale: "de-DE",
    // Judged by the route before the service is reached.
    altcha: {} as BookingRequestInput["altcha"],
    ...overrides,
  };
}

beforeAll(async () => {
  await fillLegal();
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "UTC",
      currency: "EUR",
      color: "#0f766e",
      defaultNightlyRateMinor: 10_000,
      defaultCleaningFeeMinor: 5_000,
      slug: "lake-house",
      publiclyListed: true,
    },
  });
  await saveListing(property.id, { ...EMPTY_LISTING, amenities: [], maxGuests: 4 });
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.bookingRules.deleteMany();
});

describe("a booking request from the public site", () => {
  it("becomes an inquiry from the website, with what the guest sent and a reference", async () => {
    const result = await createBookingRequest(property, input(), NOW);
    if (!("request" in result)) throw new Error(JSON.stringify(result));
    expect(result.request).toEqual({
      reference: expect.stringMatching(/^[A-HJKMNP-Z2-9]{8}$/),
      checkIn: "2026-08-10",
      checkOut: "2026-08-14",
      nights: 4,
      guestCount: 2,
      // 4 x 100.00 + 50.00 cleaning, as any booking's default total.
      totalAmountMinor: 45_000,
      currency: "EUR",
    });

    const booking = await db.booking.findUniqueOrThrow({
      where: { reference: result.request.reference },
      include: { guest: true },
    });
    expect(booking).toMatchObject({
      status: "inquiry",
      source: "website",
      guestCount: 2,
      guestMessage: "We would love to come.",
      requesterName: "Ada Lovelace",
      requesterPhone: "+49 30 1234",
      guestLocale: "de-DE",
      privacyConsentAt: NOW,
      notes: null,
    });
    expect(booking.guest).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+49 30 1234",
    });
  });

  it("finds the guest by email, keeping the name and phone given with each request", async () => {
    const existing = await db.guest.create({
      data: { name: "Ada King", email: "ada@example.test", phone: "+44 20 1" },
    });
    const result = await createBookingRequest(property, input({ phone: null }), NOW);
    if (!("request" in result)) throw new Error(JSON.stringify(result));
    const booking = await db.booking.findUniqueOrThrow({
      where: { reference: result.request.reference },
    });
    expect(booking.guestId).toBe(existing.id);
    expect(booking).toMatchObject({ requesterName: "Ada Lovelace", requesterPhone: null });
    expect(await db.guest.count()).toBe(1);
  });

  it("holds no dates: two requests for the same stay are both taken", async () => {
    expect("request" in (await createBookingRequest(property, input(), NOW))).toBe(true);
    expect(
      "request" in
        (await createBookingRequest(property, input({ email: "bob@example.test" }), NOW)),
    ).toBe(true);
  });

  it("is refused for dates taken since, without saying by what", async () => {
    const guest = await db.guest.create({ data: { name: "Bob" } });
    await db.booking.create({
      data: {
        propertyId: property.id,
        guestId: guest.id,
        checkIn: toUtcDate("2026-08-12"),
        checkOut: toUtcDate("2026-08-16"),
        status: "confirmed",
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      },
    });
    expect(await createBookingRequest(property, input(), NOW)).toEqual({
      error: "invalid",
      fields: { checkIn: ["these dates are not available"] },
    });
    expect(await db.booking.count({ where: { source: "website" } })).toBe(0);
  });

  it("is held to the booking rules and the home's capacity", async () => {
    await saveBookingRules(property.id, {
      minNights: 5,
      maxNights: null,
      minLeadDays: 0,
      horizonDays: null,
      checkInWeekdays: [],
      bufferDays: 0,
    });
    expect(await createBookingRequest(property, input({ guestCount: 5 }), NOW)).toEqual({
      error: "invalid",
      fields: {
        checkOut: ["the stay must be at least 5 nights"],
        guestCount: ["this home sleeps at most 4 guests"],
      },
    });
    // Nor in the past.
    const past = await createBookingRequest(
      property,
      input({ checkIn: "2026-06-20", checkOut: "2026-06-26" }),
      NOW,
    );
    expect(past).toMatchObject({ error: "invalid", fields: { checkIn: expect.any(Array) } });
    expect(await db.guest.count()).toBe(0);
  });

  it("is erased with the guest: the message, name and phone sent with it", async () => {
    const result = await createBookingRequest(property, input(), NOW);
    if (!("request" in result)) throw new Error(JSON.stringify(result));
    const booking = await db.booking.findUniqueOrThrow({
      where: { reference: result.request.reference },
    });
    expect(await purgeGuest(booking.guestId, null)).toMatchObject({ outcome: "anonymised" });
    expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
      guestMessage: null,
      requesterName: null,
      requesterPhone: null,
      // The facts of the booking stay.
      source: "website",
      reference: result.request.reference,
      totalAmountMinor: 45_000,
    });
  });
});

describe("the database", () => {
  it("allows a website booking only with a reference and the consent", async () => {
    const guest = await db.guest.create({ data: { name: "Eve" } });
    const data = {
      propertyId: property.id,
      guestId: guest.id,
      checkIn: toUtcDate("2026-09-01"),
      checkOut: toUtcDate("2026-09-03"),
      source: "website" as const,
      nightlyRateMinor: 0,
      cleaningFeeMinor: 0,
      totalAmountMinor: 0,
      currency: "EUR",
    };
    await expect(db.booking.create({ data })).rejects.toThrow(/bookings_website_request/);
    await expect(
      db.booking.create({ data: { ...data, reference: "abc", privacyConsentAt: NOW } }),
    ).rejects.toThrow(/bookings_reference_format/);
  });

  it("never lets a property take the legal pages' slug", async () => {
    await expect(
      db.property.create({
        data: { name: "Legal", timezone: "UTC", currency: "EUR", color: "#0f766e", slug: "legal" },
      }),
    ).rejects.toThrow(/properties_slug_not_reserved/);
  });
});
