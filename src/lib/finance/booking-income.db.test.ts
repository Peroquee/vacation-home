/**
 * Income generated from bookings, through the booking service and the
 * transaction API against a real PostgreSQL.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  GET as getSettings,
  PUT as putSettings,
} from "@/app/api/properties/[id]/income-automation/route";
import { PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { cancelBooking, createBooking, updateBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { bookingIncomeParts } from "./booking-income";

let propertyId: string;
let guestId: string;

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function automate(onCancel: "delete" | "zero" = "delete", enabled = true) {
  const response = await putSettings(
    new Request("http://localhost/x", json("PUT", { enabled, onCancel })),
    context(propertyId),
  );
  expect(response.status).toBe(200);
}

async function book(
  status: "confirmed" | "inquiry" = "confirmed",
  extra: Record<string, unknown> = {},
) {
  // 3 nights at 100 + 40 cleaning: 340.
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn: "2026-11-01",
    checkOut: "2026-11-04",
    status,
    source: "direct",
    guestCount: 2,
    nightlyRateMinor: 100_00,
    cleaningFeeMinor: 40_00,
    notes: "Allergic to cats",
    ...extra,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

const entries = (bookingId: string) =>
  db.transaction.findMany({
    where: { bookingId },
    orderBy: { generated: "asc" },
    include: { category: { select: { systemKey: true } } },
  });
const summary = async (bookingId: string) =>
  (await entries(bookingId)).map((e) => [e.generated, e.category.systemKey, e.amountMinor]);

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  guestId = (await db.guest.create({ data: { name: "Ada Lovelace" } })).id;
});

// Other files clear bookings without the ledger rows that reference them.
afterAll(async () => {
  await db.transaction.deleteMany();
  await db.$disconnect();
});

describe("settings", () => {
  it("are off until turned on", async () => {
    expect(
      await (await getSettings(new Request("http://localhost/x"), context(propertyId))).json(),
    ).toEqual({
      enabled: false,
      onCancel: "delete",
    });
    await automate("zero");
    expect(
      await (await getSettings(new Request("http://localhost/x"), context(propertyId))).json(),
    ).toEqual({
      enabled: true,
      onCancel: "zero",
    });
    const bad = await putSettings(
      new Request("http://localhost/x", json("PUT", { enabled: "yes" })),
      context(propertyId),
    );
    expect(bad.status).toBe(422);
  });

  it("leave bookings alone while off", async () => {
    const booking = await book();
    expect(await entries(booking.id)).toEqual([]);
  });
});

describe("generating income", () => {
  beforeEach(() => automate());

  it("creates accommodation and cleaning entries on confirmation, marked and linked", async () => {
    const booking = await book();
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 300_00],
      ["booking_cleaning", "cleaning_fees", 40_00],
    ]);
    const [entry] = await entries(booking.id);
    expect(entry).toMatchObject({ type: "income", currency: "EUR", propertyId, detachedAt: null });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-11-01");
    // The booking's id and dates, never the guest.
    expect(entry.description).toBe(`Booking ${booking.id} (2026-11-01 to 2026-11-04)`);
  });

  it("is not duplicated by repeated confirmation or edits, and follows the amounts", async () => {
    const booking = await book();
    await updateBooking(booking.id, { status: "confirmed" });
    await updateBooking(booking.id, { checkOut: "2026-11-06" }); // 5 nights: 500
    await updateBooking(booking.id, { cleaningFeeMinor: 60_00 });
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 500_00],
      ["booking_cleaning", "cleaning_fees", 60_00],
    ]);
    expect((await entries(booking.id))[0].date.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("waits for an inquiry to be confirmed", async () => {
    const booking = await book("inquiry");
    expect(await entries(booking.id)).toEqual([]);
    await updateBooking(booking.id, { status: "confirmed" });
    expect(await summary(booking.id)).toHaveLength(2);
  });

  it("drops the cleaning entry when there is no cleaning fee", async () => {
    const booking = await book();
    await updateBooking(booking.id, { cleaningFeeMinor: 0 });
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 300_00],
    ]);
  });

  it("does not backfill a booking confirmed before automation was on", async () => {
    await automate("delete", false);
    const booking = await book();
    await automate();
    await updateBooking(booking.id, { checkOut: "2026-11-05" });
    expect(await entries(booking.id)).toEqual([]);
  });
});

describe("cancellation", () => {
  it("deletes the generated entries, by default", async () => {
    await automate("delete");
    const booking = await book();
    await cancelBooking(booking.id);
    expect(await entries(booking.id)).toEqual([]);
    // Confirmed again: generated afresh.
    await updateBooking(booking.id, { status: "confirmed" });
    expect(await summary(booking.id)).toHaveLength(2);
  });

  it("or zeroes them, when the property says so", async () => {
    await automate("zero");
    const booking = await book();
    await cancelBooking(booking.id);
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 0],
      ["booking_cleaning", "cleaning_fees", 0],
    ]);
    await updateBooking(booking.id, { status: "confirmed" });
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 300_00],
      ["booking_cleaning", "cleaning_fees", 40_00],
    ]);
  });
});

describe("editing a generated entry by hand", () => {
  it("detaches it from automation, with a warning, and automation leaves it alone", async () => {
    await automate();
    const booking = await book();
    const [accommodation] = await entries(booking.id);

    const response = await patchTransaction(
      new Request("http://localhost/x", json("PATCH", { amountMinor: 280_00 })),
      context(accommodation.id),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ amountMinor: 280_00, generated: "booking_accommodation" });
    expect(body.detachedAt).not.toBeNull();
    expect(body.warning.code).toBe("detached_from_booking");

    // The booking changes: the detached entry stays, the other follows,
    // and no second accommodation entry appears.
    await updateBooking(booking.id, { checkOut: "2026-11-06", cleaningFeeMinor: 50_00 });
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 280_00],
      ["booking_cleaning", "cleaning_fees", 50_00],
    ]);
    await cancelBooking(booking.id);
    expect(await summary(booking.id)).toEqual([
      ["booking_accommodation", "booking_income", 280_00],
    ]);

    // A second edit warns no more.
    const again = await patchTransaction(
      new Request("http://localhost/x", json("PATCH", { description: "Adjusted" })),
      context(accommodation.id),
    );
    expect((await again.json()).warning).toBeUndefined();
  });
});

describe("the database", () => {
  it("keeps zero amounts to generated entries, and generated entries on bookings", async () => {
    const category = await db.category.findUniqueOrThrow({ where: { systemKey: "other_income" } });
    const base = {
      propertyId,
      type: "income" as const,
      categoryId: category.id,
      currency: "EUR",
      date: new Date("2026-11-01"),
    };
    await expect(db.transaction.create({ data: { ...base, amountMinor: 0 } })).rejects.toThrow(
      /transactions_amount_positive/,
    );
    await expect(
      db.transaction.create({
        data: { ...base, amountMinor: 1_00, generated: "booking_cleaning" },
      }),
    ).rejects.toThrow(/transactions_generated_has_booking/);
  });
});

describe("bookingIncomeParts", () => {
  it("never makes the accommodation negative", () => {
    expect(
      bookingIncomeParts({ totalAmountMinor: 30_00, cleaningFeeMinor: 50_00, touristTaxMinor: 0 }),
    ).toEqual({
      booking_accommodation: 0,
      booking_cleaning: 30_00,
      booking_tourist_tax: 0,
    });
  });

  it("takes the Kurtaxe out first: it is not the owner's", () => {
    expect(
      bookingIncomeParts({
        totalAmountMinor: 500_00,
        cleaningFeeMinor: 50_00,
        touristTaxMinor: 30_00,
      }),
    ).toEqual({
      booking_accommodation: 420_00,
      booking_cleaning: 50_00,
      booking_tourist_tax: 30_00,
    });
  });
});
