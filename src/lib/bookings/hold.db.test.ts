import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BookingStatus, Property } from "@/generated/prisma/client";
import { isAvailable } from "@/lib/availability/service";
import { checkStayAt } from "@/lib/booking-rules/service";
import { addDays, fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { savePaymentTerms } from "@/lib/payment-terms/service";
import { recordPayment } from "@/lib/payments/service";

import { changeDeadlines, NOT_PAST, ONLY_REQUESTS, reserveBooking, runHold } from "./hold";
import { createBooking, updateBooking } from "./service";
import { BOOKING_STATUSES, FLOW_ONLY, HOLDING_STATUSES } from "./values";

let property: Property;
let guestId: string;

/** Noon UTC on 2026-07-01: 2026-07-01 in Berlin too. The fake clock starts here. */
const NOW = new Date("2026-07-01T12:00:00Z");
/** `days` after NOW, at the same time of day. */
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const day = (days: number) => addDays("2026-07-01", days);

async function inquiry(checkIn: string, checkOut: string, propertyId = property.id) {
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn,
    checkOut,
    status: "inquiry",
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

const row = (id: string) => db.booking.findUniqueOrThrow({ where: { id } });

/** The 220.00 deposit, received `days` after NOW; its payment's id. */
async function depositPaid(bookingId: string, days: number) {
  const result = await recordPayment(
    bookingId,
    {
      kind: "deposit",
      method: "bank_transfer",
      amountMinor: 22_000,
      receivedOn: day(days),
      note: null,
    },
    at(days),
  );
  if (!("payment" in result)) throw new Error(JSON.stringify(result));
  return result.payment.id;
}
const events = (bookingId: string) =>
  db.bookingEvent
    .findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })
    .then((list) => list.map((e) => `${e.kind}:${e.key}`));

beforeAll(async () => {
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "Europe/Berlin",
      currency: "EUR",
      color: "#0f766e",
      // 4 nights: 4 x 250.00 + 100.00 = 1100.00.
      defaultNightlyRateMinor: 25_000,
      defaultCleaningFeeMinor: 10_000,
    },
  });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { bookingId: { not: null } } });
  await db.bookingPayment.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.paymentTerms.deleteMany();
});

describe("the statuses that hold dates", () => {
  it("are the same in the app and in the database", async () => {
    for (const status of BOOKING_STATUSES as readonly BookingStatus[]) {
      await db.booking.deleteMany();
      await db.block.deleteMany();
      const base = {
        propertyId: property.id,
        guestId,
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      };
      const flow =
        status === "reserved"
          ? { reservedAt: NOW, depositAmountMinor: 0, depositDueOn: toUtcDate(day(7)) }
          : status === "expired"
            ? { expiredAt: NOW }
            : {};
      await db.booking.create({
        data: {
          ...base,
          ...flow,
          status,
          checkIn: toUtcDate(day(10)),
          checkOut: toUtcDate(day(14)),
        },
      });
      const holds = (HOLDING_STATUSES as readonly string[]).includes(status);

      // Against another booking holding dates: the exclusion constraint.
      const other = db.booking.create({
        data: {
          ...base,
          status: "confirmed",
          checkIn: toUtcDate(day(12)),
          checkOut: toUtcDate(day(16)),
        },
      });
      if (holds) await expect(other, status).rejects.toThrow(/bookings_no_overlapping_held/);
      else await expect(other, status).resolves.toBeTruthy();

      // Against a block: the triggers.
      const block = db.block.create({
        data: {
          propertyId: property.id,
          startDate: toUtcDate(day(11)),
          endDate: toUtcDate(day(12)),
        },
      });
      // Nights 11 only: clear of the "other" booking, which starts on 12.
      if (holds) await expect(block, status).rejects.toThrow(/bookings_blocks_no_overlap/);
      else await expect(block, status).resolves.toBeTruthy();
    }
  });
});

describe("accepting a request", () => {
  it("reserves it under the default terms: 20% within 7 days, the rest 30 days before arrival", async () => {
    const booking = await inquiry(day(60), day(64));
    const result = await reserveBooking(booking.id, NOW);
    expect(result).toMatchObject({ booking: { status: "reserved" } });
    expect(await row(booking.id)).toMatchObject({
      status: "reserved",
      reservedAt: NOW,
      totalAmountMinor: 110_000,
      depositAmountMinor: 22_000,
      depositDueOn: toUtcDate(day(7)),
      balanceDueOn: toUtcDate(day(30)),
    });
    expect(await events(booking.id)).toEqual([`reserved:${NOW.toISOString()}`]);
  });

  it("asks for the full amount within 3 days at short notice, by the property's own terms", async () => {
    const booking = await inquiry(day(20), day(24));
    expect(await reserveBooking(booking.id, NOW)).toMatchObject({
      booking: { status: "reserved" },
    });
    expect(await row(booking.id)).toMatchObject({
      depositAmountMinor: 110_000,
      depositDueOn: toUtcDate(day(3)),
      balanceDueOn: null,
    });

    await savePaymentTerms(property.id, {
      depositPercent: null,
      depositFixedMinor: 30_000,
      depositDueDays: 5,
      balanceDueDaysBefore: 14,
      fullPaymentDueDays: 2,
    });
    const later = await inquiry(day(40), day(44));
    await reserveBooking(later.id, NOW);
    expect(await row(later.id)).toMatchObject({
      depositAmountMinor: 30_000,
      depositDueOn: toUtcDate(day(5)),
      balanceDueOn: toUtcDate(day(26)),
    });
  });

  it("judges today in the property's timezone", async () => {
    const far = await db.property.create({
      data: { name: "Far", timezone: "Pacific/Auckland", currency: "NZD", color: "#0f766e" },
    });
    // 13:00 UTC on 2026-07-01 is already 2026-07-02 in Auckland.
    const booking = await inquiry(day(60), day(64), far.id);
    await reserveBooking(booking.id, new Date("2026-07-01T13:00:00Z"));
    expect(fromUtcDate((await row(booking.id)).depositDueOn!)).toBe(day(8));
  });

  it("holds the dates: refused to every other booking, and to the public site", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);
    expect((await isAvailable(property.id, day(62), day(66))).available).toBe(false);
    const other = await inquiry(day(62), day(66));
    expect(await reserveBooking(other.id, NOW)).toMatchObject({ error: "conflict" });
    expect(
      await checkStayAt(
        property,
        { checkIn: day(61), checkOut: day(63) },
        { mode: "public", now: NOW },
      ),
    ).toEqual([expect.objectContaining({ field: "checkIn", rule: "unavailable" })]);
  });

  it("is refused for anything but an inquiry, and when the dates were taken meanwhile", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);
    expect(await reserveBooking(booking.id, NOW)).toEqual({
      error: "invalid",
      field: "status",
      message: ONLY_REQUESTS,
    });

    const late = await inquiry(day(70), day(74));
    await createBooking({
      propertyId: property.id,
      guestId,
      checkIn: day(72),
      checkOut: day(73),
      status: "confirmed",
      source: "direct",
      guestCount: 1,
    });
    expect(await reserveBooking(late.id, NOW)).toMatchObject({
      error: "conflict",
      conflicts: [expect.objectContaining({ kind: "booking", start: day(72), end: day(73) })],
    });
    expect((await row(late.id)).status).toBe("inquiry");
  });

  it("lets one of two accepted at once for the same dates win", async () => {
    const [a, b] = [await inquiry(day(60), day(64)), await inquiry(day(62), day(66))];
    const results = await Promise.all([reserveBooking(a.id, NOW), reserveBooking(b.id, NOW)]);
    expect(results.filter((r) => "booking" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r && r.error === "conflict")).toHaveLength(1);
    const statuses = (await db.booking.findMany({ select: { status: true } })).map((r) => r.status);
    expect(statuses.sort()).toEqual(["inquiry", "reserved"]);
  });

  it("reserves one request once, accepted twice at once", async () => {
    const booking = await inquiry(day(60), day(64));
    const results = await Promise.all([
      reserveBooking(booking.id, NOW),
      reserveBooking(booking.id, NOW),
    ]);
    expect(results.filter((r) => "booking" in r)).toHaveLength(1);
    expect(await db.bookingEvent.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("is the flow's to do: the owner's own writes cannot set reserved or expired", async () => {
    const booking = await inquiry(day(60), day(64));
    expect(await updateBooking(booking.id, { status: "reserved" })).toEqual({
      error: "invalid",
      field: "status",
      message: FLOW_ONLY,
    });
    expect(await updateBooking(booking.id, { status: "expired" })).toMatchObject({
      error: "invalid",
    });
  });
});

describe("the hold job, against a fake clock", () => {
  it("lets an unpaid reservation expire after its deadline and frees the dates", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);

    // Day 5: the reminder, two days ahead of the deadline on day 7.
    expect(await runHold(at(5))).toMatchObject({ expired: 0, depositReminders: 1 });
    expect(await runHold(at(5))).toMatchObject({ depositReminders: 0 });
    // Day 7, late evening in Berlin: still the deadline's day.
    expect(await runHold(new Date(`${day(7)}T21:30:00Z`))).toMatchObject({ expired: 0 });
    expect((await row(booking.id)).status).toBe("reserved");

    // Just after midnight in Berlin: the deadline has passed.
    expect(await runHold(new Date(`${day(7)}T22:30:00Z`))).toMatchObject({ expired: 1 });
    expect(await row(booking.id)).toMatchObject({ status: "expired", expiredAt: expect.any(Date) });
    expect((await isAvailable(property.id, day(60), day(64))).available).toBe(true);
    expect(await events(booking.id)).toEqual([
      `reserved:${NOW.toISOString()}`,
      `deposit_reminder:${day(7)}`,
      `reservation_expired:${day(7)}`,
    ]);
    // Again: nothing more happens.
    expect(await runHold(at(9))).toEqual({
      expired: 0,
      depositReminders: 0,
      balanceReminders: 0,
      balanceOverdue: 0,
    });

    // The dates are free for someone else.
    const next = await inquiry(day(60), day(64));
    expect(await reserveBooking(next.id, at(9))).toMatchObject({ booking: { status: "reserved" } });
  });

  it("leaves one paid in time alone, then reminds of the balance and reports it overdue", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);
    // The deposit arrived on day 3.
    const deposit = await depositPaid(booking.id, 3);
    expect((await row(booking.id)).status).toBe("confirmed");

    expect(await runHold(at(8))).toMatchObject({ expired: 0, balanceReminders: 0 });
    expect((await row(booking.id)).status).toBe("confirmed");
    // The balance is due on day 30: reminded from day 23, overdue from day 31.
    expect(await runHold(at(22))).toMatchObject({ balanceReminders: 0 });
    expect(await runHold(at(23))).toMatchObject({ balanceReminders: 1 });
    expect(await runHold(at(30))).toMatchObject({ balanceReminders: 0, balanceOverdue: 0 });
    expect(await runHold(at(31))).toMatchObject({ balanceOverdue: 1 });
    expect(await runHold(at(32))).toMatchObject({ balanceOverdue: 0 });
    // Never cancelled by the job.
    expect((await row(booking.id)).status).toBe("confirmed");
    expect(await events(booking.id)).toEqual([
      `reserved:${NOW.toISOString()}`,
      `deposit_received:${deposit}`,
      `balance_reminder:${day(30)}`,
      `balance_overdue:${day(30)}`,
    ]);
  });

  it("gives an extended deadline its own reminder, and expires only after it", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);
    await runHold(at(5));
    expect(await changeDeadlines(booking.id, { depositDueOn: day(10) }, at(6))).toMatchObject({
      booking: { status: "reserved" },
    });
    expect(await runHold(at(8))).toMatchObject({ expired: 0, depositReminders: 1 });
    expect(await runHold(at(10))).toMatchObject({ expired: 0 });
    expect(await runHold(at(11))).toMatchObject({ expired: 1 });
    expect(await events(booking.id)).toEqual([
      `reserved:${NOW.toISOString()}`,
      `deposit_reminder:${day(7)}`,
      `deposit_reminder:${day(10)}`,
      `reservation_expired:${day(10)}`,
    ]);
  });

  it("refuses a deadline in the past or one that is no longer open", async () => {
    const booking = await inquiry(day(60), day(64));
    await reserveBooking(booking.id, NOW);
    expect(await changeDeadlines(booking.id, { depositDueOn: day(-1) }, NOW)).toEqual({
      error: "invalid",
      field: "depositDueOn",
      message: NOT_PAST,
    });
    expect(await changeDeadlines(booking.id, { depositDueOn: day(40) }, NOW)).toMatchObject({
      error: "invalid",
      field: "depositDueOn",
    });
    await depositPaid(booking.id, 0);
    expect(await changeDeadlines(booking.id, { depositDueOn: day(9) }, NOW)).toMatchObject({
      error: "invalid",
      field: "depositDueOn",
    });
    expect(await changeDeadlines(booking.id, { balanceDueOn: day(35) }, NOW)).toMatchObject({
      booking: { status: "confirmed" },
    });
  });
});
