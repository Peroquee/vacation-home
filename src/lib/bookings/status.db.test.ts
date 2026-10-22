import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { newReference } from "@/lib/booking-requests/reference";
import { addDays } from "@/lib/calendar-date";
import { refundOutstanding } from "@/lib/cancellation/preview";
import { db } from "@/lib/db";
import { recordPayment } from "@/lib/payments/service";

import { reserveBooking, runHold } from "./hold";
import { cancelBooking, createBooking, reinstateBooking, updateBooking } from "./service";
import { MONEY_HELD, ONLY_ENDED, STATUS_BY_ACTION } from "./values";

/**
 * Who may change a booking's status, and how (GitLab #135): a hand-entered
 * booking outside the payment flow by hand; everything else only through
 * the actions - accept, record a payment, cancel, reinstate.
 */

let property: Property;
let guestId: string;

/** Noon UTC on 2026-07-01, the fake clock: 2026-07-01 in Berlin too. */
const NOW = new Date("2026-07-01T12:00:00Z");
const day = (days: number) => addDays("2026-07-01", days);
/** 4 nights at 250.00 plus 100.00 cleaning: 1100.00, a 20% deposit of 220.00. */
const STAY = { checkIn: day(60), checkOut: day(64) };

async function handEntered(
  source: "airbnb" | "direct" = "airbnb",
  status: "inquiry" | "confirmed" | "paid" = "confirmed",
) {
  const result = await createBooking({
    propertyId: property.id,
    guestId,
    ...STAY,
    status,
    source,
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

/** A request as the public site stores it. */
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
    { reference: newReference(), guestLocale: "en-GB", privacyConsentAt: NOW },
  );
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

async function reserved() {
  const booking = await request();
  const result = await reserveBooking(booking.id, NOW);
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

async function pay(bookingId: string, kind: "deposit" | "refund", amountMinor: number) {
  const result = await recordPayment(
    bookingId,
    { kind, method: "bank_transfer", amountMinor, receivedOn: "2026-07-01", note: null },
    NOW,
  );
  if (!("payment" in result)) throw new Error(JSON.stringify(result));
}

const row = (id: string) => db.booking.findUniqueOrThrow({ where: { id } });
const kinds = (bookingId: string) =>
  db.bookingEvent
    .findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })
    .then((list) => list.map((e) => e.kind));
const byAction = { error: "invalid", field: "status", message: STATUS_BY_ACTION };

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
  await db.bookingEvent.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
});

describe("a status set by hand", () => {
  it("is fine for a platform booking outside the payment flow: inquiry, confirmed or paid", async () => {
    const booking = await handEntered("airbnb", "confirmed");
    for (const status of ["paid", "inquiry", "confirmed"] as const) {
      expect(await updateBooking(booking.id, { status })).toHaveProperty("booking.status", status);
    }
  });

  it("can be paid from the start, for a booking paid on the platform", async () => {
    const result = await createBooking({
      propertyId: property.id,
      guestId,
      ...STAY,
      status: "paid",
      source: "booking.com",
      guestCount: 2,
    });
    expect(result).toHaveProperty("booking.status", "paid");
  });

  it("never writes cancelled: that is the cancel action's", async () => {
    const booking = await handEntered();
    expect(await updateBooking(booking.id, { status: "cancelled" })).toEqual(byAction);
    expect(
      await createBooking({
        propertyId: property.id,
        guestId,
        checkIn: day(80),
        checkOut: day(82),
        status: "cancelled",
        source: "airbnb",
        guestCount: 2,
      }),
    ).toEqual(byAction);
    expect((await row(booking.id)).status).toBe("confirmed");
  });

  it("is refused for a request from the website, before and after it is accepted", async () => {
    const booking = await request();
    expect(await updateBooking(booking.id, { status: "confirmed" })).toEqual(byAction);
    await reserveBooking(booking.id, NOW);
    expect(await updateBooking(booking.id, { status: "confirmed" })).toEqual(byAction);
    expect(await updateBooking(booking.id, { status: "paid" })).toEqual(byAction);
    expect((await row(booking.id)).status).toBe("reserved");
  });

  it("is refused once a hand-entered booking has joined the payment flow", async () => {
    const reservedByHand = await handEntered("direct", "inquiry");
    await reserveBooking(reservedByHand.id, NOW);
    expect(await updateBooking(reservedByHand.id, { status: "confirmed" })).toEqual(byAction);

    await db.transaction.deleteMany({ where: { bookingId: { not: null } } });
    await db.booking.deleteMany();
    const paidHere = await handEntered("direct", "confirmed");
    await pay(paidHere.id, "deposit", 10_000);
    expect(await updateBooking(paidHere.id, { status: "inquiry" })).toEqual(byAction);
  });

  it("may be sent back unchanged with the rest of the form", async () => {
    const booking = await reserved();
    expect(
      await updateBooking(booking.id, { status: "reserved", notes: "late arrival" }),
    ).toHaveProperty("booking.notes", "late arrival");
  });

  it("leaves a paid deposit's refund to the cancel action", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 22_000);
    expect(await updateBooking(booking.id, { status: "cancelled" })).toEqual(byAction);

    const cancelled = await cancelBooking(booking.id, { by: "owner" }, NOW);
    expect(cancelled).toHaveProperty("booking.status", "cancelled");
    const after = await row(booking.id);
    expect(after).toMatchObject({ cancelledBy: "owner", refundDueMinor: 22_000 });
    expect(await refundOutstanding(after)).toBe(22_000);
    expect(await kinds(booking.id)).toContain("cancelled");
  });
});

describe("reinstating", () => {
  it("brings a cancelled booking back as an inquiry, without its cancellation", async () => {
    const booking = await handEntered();
    await cancelBooking(booking.id, { by: "owner" }, NOW);
    expect(await updateBooking(booking.id, { status: "inquiry" })).toEqual(byAction);

    expect(await reinstateBooking(booking.id, NOW)).toHaveProperty("booking.status", "inquiry");
    expect(await row(booking.id)).toMatchObject({
      cancelledAt: null,
      cancelledBy: null,
      refundDueMinor: null,
    });
    expect(await kinds(booking.id)).toEqual(["cancelled", "reinstated"]);
  });

  it("brings an expired reservation back as an inquiry, without its deadlines", async () => {
    const booking = await reserved();
    await runHold(new Date(`${day(8)}T12:00:00Z`));
    expect((await row(booking.id)).status).toBe("expired");

    expect(await reinstateBooking(booking.id, NOW)).toHaveProperty("booking.status", "inquiry");
    expect(await row(booking.id)).toMatchObject({
      expiredAt: null,
      reservedAt: null,
      depositAmountMinor: null,
      depositDueOn: null,
      balanceDueOn: null,
    });
  });

  it("is refused while money is held: refund it first, or make a new booking", async () => {
    const booking = await reserved();
    await pay(booking.id, "deposit", 22_000);
    // The guest cancels: the non-refundable deposit is kept.
    await cancelBooking(booking.id, { by: "guest" }, NOW);
    expect(await reinstateBooking(booking.id, NOW)).toEqual({
      error: "invalid",
      field: "status",
      message: MONEY_HELD,
    });
    expect((await row(booking.id)).status).toBe("cancelled");
  });

  it("is refused when the dates have been taken meanwhile", async () => {
    const first = await handEntered();
    await cancelBooking(first.id, { by: "owner" }, NOW);
    const second = await handEntered();
    const result = await reinstateBooking(first.id, NOW);
    expect(result).toMatchObject({ error: "conflict" });
    expect(result).toHaveProperty("conflicts.0.id", second.id);
    expect((await row(first.id)).status).toBe("cancelled");
  });

  it("is only for a cancelled or expired booking", async () => {
    const booking = await handEntered();
    expect(await reinstateBooking(booking.id, NOW)).toEqual({
      error: "invalid",
      field: "status",
      message: ONLY_ENDED,
    });
  });
});
