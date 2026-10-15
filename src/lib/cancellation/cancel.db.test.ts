import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { isAvailable } from "@/lib/availability/service";
import { reserveBooking } from "@/lib/bookings/hold";
import { cancelBooking, createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { savePaymentTerms } from "@/lib/payment-terms/service";
import { DEFAULT_TERMS } from "@/lib/payment-terms/terms";
import { recordPayment } from "@/lib/payments/service";

import { cancellationPreview, refundOutstanding } from "./preview";

let property: Property;
let guestId: string;

/** 4 nights at 250.00 plus 100.00 cleaning: 1100.00, a 20% deposit of 220.00. */
const STAY = { checkIn: "2027-03-01", checkOut: "2027-03-05" };

async function request() {
  const result = await createBooking(
    {
      propertyId: property.id,
      guestId,
      ...STAY,
      status: "inquiry",
      source: "website",
      guestCount: 2,
    },
    { reference: `R${Math.random().toString(36).slice(2, 9).toUpperCase()}`, guestLocale: "en-GB" },
  );
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

async function reserved() {
  const booking = await request();
  const result = await reserveBooking(booking.id);
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

async function pay(bookingId: string, kind: "deposit" | "balance" | "refund", amountMinor: number) {
  const result = await recordPayment(bookingId, {
    kind,
    method: "bank_transfer",
    amountMinor,
    receivedOn: "2026-10-01",
    note: null,
  });
  if (!("payment" in result)) throw new Error(JSON.stringify(result));
}

const row = (id: string) => db.booking.findUniqueOrThrow({ where: { id } });
const free = async () => (await isAvailable(property.id, STAY.checkIn, STAY.checkOut)).available;

beforeAll(async () => {
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "Europe/Berlin",
      currency: "EUR",
      color: "#0f766e",
      defaultNightlyRateMinor: 25_000,
      defaultCleaningFeeMinor: 10_000,
    },
  });
  guestId = (await db.guest.create({ data: { name: "Ada", email: "ada@example.test" } })).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { bookingId: { not: null } } });
  await db.bookingPayment.deleteMany();
  await db.booking.deleteMany();
  await db.paymentTerms.deleteMany();
});

describe("the policy a booking is under", () => {
  it("is taken when the guest sends the request, and kept through later changes", async () => {
    const booking = await request();
    expect((await row(booking.id)).cancellationPolicy).toEqual({
      depositNonRefundable: true,
      depositAmountMinor: 22_000,
    });

    // The owner changes the terms; the request keeps what the guest agreed to.
    await savePaymentTerms(property.id, {
      ...DEFAULT_TERMS,
      depositPercent: 50,
      depositNonRefundable: false,
    });
    await reserveBooking(booking.id);
    expect((await row(booking.id)).cancellationPolicy).toEqual({
      depositNonRefundable: true,
      depositAmountMinor: 22_000,
    });
    expect((await cancellationPreview(booking.id))!.policy.depositNonRefundable).toBe(true);
  });

  it("is taken when the owner makes a booking, or reserves one that has none", async () => {
    await savePaymentTerms(property.id, { ...DEFAULT_TERMS, depositNonRefundable: false });
    const made = await createBooking({
      propertyId: property.id,
      guestId,
      ...STAY,
      status: "confirmed",
      source: "direct",
      guestCount: 2,
    });
    if (!("booking" in made)) throw new Error(JSON.stringify(made));
    expect(made.booking.cancellationPolicy).toEqual({
      depositNonRefundable: false,
      depositAmountMinor: 22_000,
    });
    await cancelBooking(made.booking.id);

    const inquiry = await createBooking({
      propertyId: property.id,
      guestId,
      ...STAY,
      status: "inquiry",
      source: "direct",
      guestCount: 2,
    });
    if (!("booking" in inquiry)) throw new Error(JSON.stringify(inquiry));
    expect(inquiry.booking.cancellationPolicy).toBeNull();
    await reserveBooking(inquiry.booking.id);
    expect((await row(inquiry.booking.id)).cancellationPolicy).toMatchObject({
      depositNonRefundable: false,
    });
  });

  it("leaves a terms update without the switch as it was", async () => {
    await savePaymentTerms(property.id, { ...DEFAULT_TERMS, depositNonRefundable: false });
    const withoutSwitch = { ...DEFAULT_TERMS, depositNonRefundable: undefined };
    expect((await savePaymentTerms(property.id, withoutSwitch)).depositNonRefundable).toBe(false);
  });
});

describe("a guest cancelling", () => {
  it("before paying gets nothing back, and the dates are free", async () => {
    const booking = await reserved();
    expect(await free()).toBe(false);
    const result = await cancelBooking(booking.id, { by: "guest" });
    expect(result).toMatchObject({ booking: { status: "cancelled", refundDueMinor: 0 } });
    expect(await free()).toBe(true);
  });

  it("forfeits the deposit, and gets back anything beyond it", async () => {
    const depositOnly = await reserved();
    await pay(depositOnly.id, "deposit", 22_000);
    await cancelBooking(depositOnly.id, { by: "guest" });
    expect((await row(depositOnly.id)).refundDueMinor).toBe(0);

    const paid = await reserved();
    await pay(paid.id, "deposit", 22_000);
    await pay(paid.id, "balance", 88_000);
    expect((await cancellationPreview(paid.id))!.guest).toEqual({
      receivedMinor: 110_000,
      retainedMinor: 22_000,
      refundMinor: 88_000,
    });
    await cancelBooking(paid.id, { by: "guest" });
    expect(await row(paid.id)).toMatchObject({
      status: "cancelled",
      cancelledBy: "guest",
      refundDueMinor: 88_000,
    });
  });

  it("keeps no more than was paid when less than the deposit came in", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 10_000);
    await cancelBooking(booking.id, { by: "guest" });
    expect((await row(booking.id)).refundDueMinor).toBe(0);
  });
});

describe("cancelling", () => {
  it("by the owner refunds everything; the refund can be changed, within what was received", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 22_000);
    expect(await cancelBooking(booking.id, { by: "owner", refundMinor: 22_001 })).toEqual({
      error: "invalid",
      field: "refundMinor",
      message: "cannot be more than was received",
    });
    expect((await row(booking.id)).status).toBe("confirmed");

    await cancelBooking(booking.id);
    expect(await row(booking.id)).toMatchObject({ cancelledBy: "owner", refundDueMinor: 22_000 });

    const other = await reserved();
    await pay(other.id, "deposit", 22_000);
    await cancelBooking(other.id, { by: "guest", refundMinor: 5_000 });
    expect((await row(other.id)).refundDueMinor).toBe(5_000);
  });

  it("happens once: a second time changes nothing and mails nothing more", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 22_000);
    await cancelBooking(booking.id, { by: "guest" });
    const first = await row(booking.id);
    await cancelBooking(booking.id, { by: "owner" });
    expect(await row(booking.id)).toMatchObject({
      cancelledBy: "guest",
      cancelledAt: first.cancelledAt,
      refundDueMinor: 0,
    });
    expect(
      await db.bookingEvent.count({ where: { bookingId: booking.id, kind: "cancelled" } }),
    ).toBe(1);
  });

  it("shows the refund as due until it is recorded, then in the ledger", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 22_000);
    await pay(booking.id, "balance", 88_000);
    await cancelBooking(booking.id, { by: "guest" });
    expect(await refundOutstanding(await row(booking.id))).toBe(88_000);

    await pay(booking.id, "refund", 88_000);
    expect(await refundOutstanding(await row(booking.id))).toBe(0);
    const ledger = await db.transaction.findMany({
      where: { bookingId: booking.id },
      select: { type: true, amountMinor: true },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger).toEqual([
      { type: "income", amountMinor: 22_000 },
      { type: "income", amountMinor: 88_000 },
      { type: "income", amountMinor: -88_000 },
    ]);
  });
});
