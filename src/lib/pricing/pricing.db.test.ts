/**
 * Seasonal prices against a real PostgreSQL (GitLab #118): seasons are
 * stored and refused when they overlap, every price comes from the one
 * engine - the public estimate, the booking's total and the amount the
 * guest is asked for at reserve agree - and a booking keeps its price when
 * the seasons change.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { getPublicAvailability } from "@/lib/booking-rules/public-availability";
import { createBookingRequest } from "@/lib/booking-requests/service";
import type { BookingRequestInput } from "@/lib/booking-requests/schema";
import { reserveBooking } from "@/lib/bookings/hold";
import { breakdownOf, createBooking, updateBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { fillLegal } from "@/lib/legal/testing/complete-legal";
import { EMPTY_LISTING, saveListing } from "@/lib/listing/service";
import { savePaymentTerms } from "@/lib/payment-terms/service";
import { DEFAULT_TERMS, depositFor } from "@/lib/payment-terms/terms";

import { priceStay } from "./engine";
import type { SeasonInput } from "./schema";
import { deleteSeason, listSeasons, pricingRulesFor, saveSeason } from "./service";

let property: Property;
let guestId: string;
const NOW = new Date("2026-07-01T12:00:00Z");

const SUMMER: SeasonInput = {
  name: "Hauptsaison",
  startMonth: 8,
  startDay: 12,
  endMonth: 8,
  endDay: 31,
  year: null,
  rateMinor: 14_000,
};

async function season(input: SeasonInput) {
  const result = await saveSeason(property.id, input);
  if (!("season" in result)) throw new Error(JSON.stringify(result));
  return result.season;
}

beforeAll(async () => {
  await fillLegal();
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "Europe/Berlin",
      currency: "EUR",
      color: "#0f766e",
      defaultNightlyRateMinor: 10_000,
      defaultCleaningFeeMinor: 5_000,
      slug: "lake-house",
      publiclyListed: true,
    },
  });
  await saveListing(property.id, { ...EMPTY_LISTING, amenities: [], maxGuests: 4 });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.bookingEvent.deleteMany();
  await db.booking.deleteMany({ where: { propertyId: property.id } });
  await db.propertySeason.deleteMany();
  await db.paymentTerms.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("seasons", () => {
  it("are kept per property, and an overlapping one of the same kind is refused", async () => {
    const summer = await season(SUMMER);
    expect(await saveSeason(property.id, { ...SUMMER, name: "Spätsommer", startDay: 30 })).toEqual({
      error: "overlaps",
      with: "Hauptsaison",
    });
    // A one-off week inside it is fine, and wins on its days.
    await season({
      ...SUMMER,
      name: "Festwoche",
      startDay: 20,
      endDay: 22,
      year: 2026,
      rateMinor: 20_000,
    });
    // Editing a season does not clash with itself.
    expect(await saveSeason(property.id, { ...SUMMER, endDay: 30 }, summer.id)).toMatchObject({
      season: { endDay: 30 },
    });
    expect((await listSeasons(property.id)).map((s) => s.name)).toEqual([
      "Hauptsaison",
      "Festwoche",
    ]);
    expect(await saveSeason(property.id, SUMMER, "00000000-0000-4000-8000-000000000000")).toEqual({
      error: "not_found",
    });
    expect(await deleteSeason(property.id, summer.id)).toBe(true);
    expect(await deleteSeason(property.id, summer.id)).toBe(false);
  });
});

describe("one price everywhere", () => {
  const request = (overrides: Partial<BookingRequestInput> = {}): BookingRequestInput => ({
    checkIn: "2026-08-10",
    checkOut: "2026-08-14",
    guestCount: 2,
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: null,
    message: "",
    consent: true,
    locale: "de-DE",
    altcha: {} as BookingRequestInput["altcha"],
    ...overrides,
  });

  it("the public estimate, the booking's total and the amount asked at reserve agree", async () => {
    await season(SUMMER);
    await savePaymentTerms(property.id, { ...DEFAULT_TERMS, depositPercent: 30 });

    // What the guest's browser prices, from what the public API sends it.
    const { pricing } = await getPublicAvailability(
      property,
      { from: "2026-08-01", to: "2026-08-31" },
      NOW,
    );
    const estimate = priceStay(pricing, { checkIn: "2026-08-10", checkOut: "2026-08-14" });
    // 10, 11 Aug at 100.00; 12, 13 Aug in the summer at 140.00; 50.00 cleaning.
    expect(estimate.nights).toEqual([
      { season: null, nights: 2, rateMinor: 10_000, amountMinor: 20_000 },
      { season: "Hauptsaison", nights: 2, rateMinor: 14_000, amountMinor: 28_000 },
    ]);
    expect(estimate.totalMinor).toBe(53_000);

    const sent = await createBookingRequest(property, request(), NOW);
    if (!("request" in sent)) throw new Error(JSON.stringify(sent));
    expect(sent.request.totalAmountMinor).toBe(estimate.totalMinor);
    const booking = await db.booking.findUniqueOrThrow({
      where: { reference: sent.request.reference },
    });
    expect(breakdownOf(booking)).toEqual(estimate);

    const reserved = await reserveBooking(booking.id, NOW);
    if (!("booking" in reserved)) throw new Error(JSON.stringify(reserved));
    expect(reserved.booking.totalAmountMinor).toBe(estimate.totalMinor);
    expect(reserved.booking.depositAmountMinor).toBe(
      depositFor(estimate.totalMinor, { ...DEFAULT_TERMS, depositPercent: 30 }),
    );
  });

  it("the owner's booking is priced by the same rules", async () => {
    await season(SUMMER);
    const made = await createBooking({
      propertyId: property.id,
      guestId,
      checkIn: "2026-08-10",
      checkOut: "2026-08-14",
      status: "confirmed",
      source: "direct",
      guestCount: 2,
    });
    if (!("booking" in made)) throw new Error(JSON.stringify(made));
    const rules = await pricingRulesFor(property);
    expect(made.booking.totalAmountMinor).toBe(
      priceStay(rules, { checkIn: "2026-08-10", checkOut: "2026-08-14" }).totalMinor,
    );
    expect(made.booking.nightlyRateMinor).toBeNull();
  });
});

describe("a booking's price", () => {
  async function confirmed(extra: Record<string, unknown> = {}) {
    const made = await createBooking({
      propertyId: property.id,
      guestId,
      checkIn: "2026-08-10",
      checkOut: "2026-08-14",
      status: "confirmed",
      source: "direct",
      guestCount: 2,
      ...extra,
    });
    if (!("booking" in made)) throw new Error(JSON.stringify(made));
    return made.booking;
  }

  it("stays as agreed when the seasons change, also through other edits", async () => {
    const summer = await season(SUMMER);
    const booking = await confirmed();
    expect(booking.totalAmountMinor).toBe(53_000);

    await saveSeason(property.id, { ...SUMMER, rateMinor: 30_000 }, summer.id);
    const edited = await updateBooking(booking.id, { notes: "Late arrival", guestCount: 3 });
    if (!("booking" in edited)) throw new Error(JSON.stringify(edited));
    expect(edited.booking.totalAmountMinor).toBe(53_000);
    expect(breakdownOf(edited.booking)).toEqual(breakdownOf(booking));
  });

  it("is worked out anew, by today's seasons, when its dates or rates change", async () => {
    const summer = await season(SUMMER);
    const booking = await confirmed();
    await saveSeason(property.id, { ...SUMMER, rateMinor: 30_000 }, summer.id);

    const moved = await updateBooking(booking.id, { checkOut: "2026-08-15" });
    if (!("booking" in moved)) throw new Error(JSON.stringify(moved));
    // 2 x 100.00 + 3 x 300.00 + 50.00.
    expect(moved.booking.totalAmountMinor).toBe(115_000);

    const flat = await updateBooking(booking.id, { nightlyRateMinor: 9_000 });
    if (!("booking" in flat)) throw new Error(JSON.stringify(flat));
    expect(flat.booking.totalAmountMinor).toBe(5 * 9_000 + 5_000);

    // Null hands the nights back to the seasons.
    const back = await updateBooking(booking.id, { nightlyRateMinor: null });
    if (!("booking" in back)) throw new Error(JSON.stringify(back));
    expect(back.booking.totalAmountMinor).toBe(115_000);
  });

  it("set by hand stays, and handed back is worked out", async () => {
    await season(SUMMER);
    const booking = await confirmed({ totalAmountMinor: 40_000 });
    expect(booking).toMatchObject({ totalAmountMinor: 40_000, totalIsManual: true });
    // What the engine would have said, for the owner to compare.
    expect(breakdownOf(booking)).toMatchObject({ kind: "computed", totalMinor: 53_000 });
    const back = await updateBooking(booking.id, { totalAmountMinor: null });
    if (!("booking" in back)) throw new Error(JSON.stringify(back));
    expect(back.booking).toMatchObject({ totalAmountMinor: 53_000, totalIsManual: false });
  });

  it("of a booking from before reads as legacy, its total unchanged", async () => {
    const legacy = await db.booking.create({
      data: {
        propertyId: property.id,
        guestId,
        checkIn: new Date("2026-09-01T00:00:00Z"),
        checkOut: new Date("2026-09-03T00:00:00Z"),
        status: "confirmed",
        source: "direct",
        guestCount: 1,
        nightlyRateMinor: 12_000,
        cleaningFeeMinor: 0,
        totalAmountMinor: 24_000,
        currency: "EUR",
      },
    });
    expect(breakdownOf(legacy)).toEqual({
      version: 1,
      kind: "legacy",
      currency: "EUR",
      totalMinor: 24_000,
    });
    const edited = await updateBooking(legacy.id, { notes: "kept" });
    if (!("booking" in edited)) throw new Error(JSON.stringify(edited));
    expect(edited.booking.totalAmountMinor).toBe(24_000);
  });
});
