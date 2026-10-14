import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { reserveBooking, runHold } from "@/lib/bookings/hold";
import { createBooking } from "@/lib/bookings/service";
import { addDays } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import {
  answerBy,
  countOpenRequests,
  declineRequest,
  expireRequests,
  listAwaitingPayment,
  listOpenRequests,
  ONLY_INQUIRIES,
} from "./inbox";
import { anonymiseOldRequests } from "./retention";
import { newReference } from "./service";
import { saveRequestSettings } from "./settings";

let property: Property;

/** Noon UTC on 2026-07-01; the fake clock moves from here. */
const NOW = new Date("2026-07-01T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const day = (days: number) => addDays("2026-07-01", days);
let n = 0;

/** A request from the public site, received at `receivedAt`, by a guest of its own. */
async function request(
  checkIn: string,
  checkOut: string,
  { receivedAt = NOW, email = `guest${++n}@example.test` } = {},
) {
  const guest = await db.guest.create({ data: { name: `Guest ${n}`, email } });
  const result = await createBooking(
    {
      propertyId: property.id,
      guestId: guest.id,
      checkIn,
      checkOut,
      status: "inquiry",
      source: "website",
      guestCount: 2,
    },
    {
      reference: newReference(),
      guestMessage: "Hello!",
      requesterName: `Requester ${n}`,
      requesterPhone: "+49 30 1",
      guestLocale: "en-GB",
      privacyConsentAt: receivedAt,
    },
  );
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  await db.booking.update({ where: { id: result.booking.id }, data: { createdAt: receivedAt } });
  return { booking: result.booking, guestId: guest.id };
}

const status = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).status;
const kinds = async (bookingId: string) =>
  (await db.bookingEvent.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })).map(
    (e) => e.kind,
  );

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
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.requestSettings.deleteMany();
});

describe("the inbox", () => {
  it("lists open requests with what the guest sent, and when to answer by", async () => {
    const { booking } = await request(day(30), day(33));
    await createBooking({
      propertyId: property.id,
      guestId: (await db.guest.create({ data: { name: "Owner's own" } })).id,
      checkIn: day(40),
      checkOut: day(42),
      status: "inquiry",
      source: "direct",
      guestCount: 1,
    });
    expect(await countOpenRequests()).toBe(1);
    expect(await listOpenRequests()).toEqual([
      expect.objectContaining({
        id: booking.id,
        name: expect.stringMatching(/^Requester /),
        message: "Hello!",
        phone: "+49 30 1",
        guestCount: 2,
        totalAmountMinor: 30_000,
        answerBy: day(3),
      }),
    ]);
    expect(await kinds(booking.id)).toEqual(["requested"]);
  });

  it("lists what is still to be paid, the earliest deadline first", async () => {
    const far = await request(day(90), day(94));
    const near = await request(day(20), day(24));
    await reserveBooking(far.booking.id, NOW);
    await reserveBooking(near.booking.id, NOW);
    expect(
      (await listAwaitingPayment()).map(({ id, due, amountMinor, dueOn }) => ({
        id,
        due,
        amountMinor,
        dueOn,
      })),
    ).toEqual([
      { id: near.booking.id, due: "full", amountMinor: 40_000, dueOn: day(3) },
      { id: far.booking.id, due: "deposit", amountMinor: 8_000, dueOn: day(7) },
    ]);
  });
});

describe("accepting and declining", () => {
  it("refuses to accept a request whose dates were taken meanwhile, naming the conflict", async () => {
    const first = await request(day(30), day(34));
    const second = await request(day(32), day(36));
    await reserveBooking(first.booking.id, NOW);
    expect(await reserveBooking(second.booking.id, NOW)).toMatchObject({
      error: "conflict",
      conflicts: [{ kind: "booking", id: first.booking.id, start: day(30), end: day(34) }],
    });
    expect(await status(second.booking.id)).toBe("inquiry");
  });

  it("declines with a reason for the guest, once", async () => {
    const { booking } = await request(day(30), day(34));
    expect(await declineRequest(booking.id, "Sorry, we are away.", NOW)).toMatchObject({
      booking: { status: "cancelled" },
    });
    expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
      declinedAt: NOW,
      declineReason: "Sorry, we are away.",
    });
    expect(await declineRequest(booking.id, null, NOW)).toEqual({
      error: "invalid",
      field: "status",
      message: ONLY_INQUIRIES,
    });
    expect(await kinds(booking.id)).toEqual(["requested", "declined"]);
    expect(await countOpenRequests()).toBe(0);
  });
});

describe("expiry, against a fake clock", () => {
  it("lets a request unanswered for the property's days expire, in its timezone", async () => {
    const { booking } = await request(day(30), day(34));
    expect(answerBy("2026-07-01", 3)).toBe(day(3));
    // The last day to answer, late evening in Berlin: still open.
    expect(await expireRequests(new Date(`${day(3)}T21:30:00Z`))).toBe(0);
    expect(await expireRequests(new Date(`${day(3)}T22:30:00Z`))).toBe(1);
    expect(await status(booking.id)).toBe("expired");
    expect(await kinds(booking.id)).toEqual(["requested", "request_expired"]);
    // Again: nothing more.
    expect(await expireRequests(at(10))).toBe(0);
  });

  it("follows the property's setting, and leaves answered requests alone", async () => {
    await saveRequestSettings(property.id, { expiryDays: 7, retentionMonths: 6 });
    const open = await request(day(30), day(34));
    const accepted = await request(day(40), day(44));
    await reserveBooking(accepted.booking.id, at(1));
    expect(await expireRequests(at(5))).toBe(0);
    expect(await expireRequests(at(8))).toBe(1);
    expect(await status(open.booking.id)).toBe("expired");
    // The reservation is the hold job's: its own deadline, day 8.
    expect(await status(accepted.booking.id)).toBe("reserved");
    await runHold(at(10));
    expect(await status(accepted.booking.id)).toBe("expired");
  });
});

describe("retention", () => {
  it("anonymises declined and expired requests after the retention, unless the guest has other bookings", async () => {
    const declined = await request(day(30), day(34));
    await declineRequest(declined.booking.id, "No.", NOW);
    const expired = await request(day(40), day(44));
    await expireRequests(at(5));

    // The same guest has a confirmed stay too: kept.
    const regular = await request(day(50), day(54), { email: "regular@example.test" });
    await declineRequest(regular.booking.id, null, NOW);
    await db.booking.create({
      data: {
        propertyId: property.id,
        guestId: regular.guestId,
        checkIn: new Date(`${day(100)}T00:00:00Z`),
        checkOut: new Date(`${day(102)}T00:00:00Z`),
        status: "confirmed",
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      },
    });

    // Declined at noon on 1 July, expired at noon on 6 July: each is erased
    // six calendar months later to the minute, not a moment before. 31
    // December is the month-end case (less six months: 30 June).
    expect(await anonymiseOldRequests(new Date("2026-12-31T12:00:00Z"))).toBe(0);
    expect(await anonymiseOldRequests(new Date("2027-01-01T11:59:59Z"))).toBe(0);
    expect(await anonymiseOldRequests(new Date("2027-01-01T12:00:00Z"))).toBe(1);
    expect(await db.guest.findUniqueOrThrow({ where: { id: expired.guestId } })).toMatchObject({
      purgedAt: null,
    });
    expect(await anonymiseOldRequests(new Date("2027-01-06T11:59:59Z"))).toBe(0);
    expect(await anonymiseOldRequests(new Date("2027-01-06T12:00:00Z"))).toBe(1);

    for (const { booking, guestId } of [declined, expired]) {
      expect(await db.guest.findUniqueOrThrow({ where: { id: guestId } })).toMatchObject({
        name: "Deleted guest",
        email: null,
        purgedAt: expect.any(Date),
      });
      expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({
        guestMessage: null,
        requesterName: null,
        requesterPhone: null,
        declineReason: null,
      });
    }
    expect(await db.guest.findUniqueOrThrow({ where: { id: regular.guestId } })).toMatchObject({
      purgedAt: null,
      email: "regular@example.test",
    });
    // Again: nothing more.
    expect(await anonymiseOldRequests(new Date("2027-02-01T12:00:00Z"))).toBe(0);
  });
});
