import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { reserveBooking } from "@/lib/bookings/hold";
import { createBooking, updateBooking } from "@/lib/bookings/service";
import { declineRequest } from "@/lib/booking-requests/inbox";
import { addDays } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/today";
import { FROM_PAYMENT, updateTransaction } from "@/lib/finance/transactions";

import { saveBankDetails } from "./bank";
import { bookingForToken, issueGuestToken } from "./guest-link";
import { guestView } from "./guest-view";
import {
  deletePayment,
  IN_THE_FUTURE,
  MORE_THAN_RECEIVED,
  NOT_PAYABLE,
  type PaymentInput,
  recordPayment,
} from "./service";

let property: Property;
let guestId: string;
/** Noon UTC on 2026-07-01: 2026-07-01 in Berlin too. */
const NOW = new Date("2026-07-01T12:00:00Z");
const day = (days: number) => addDays("2026-07-01", days);

/** A booking of 4 nights at 250.00 + 100.00 cleaning: 1100.00. */
async function booking(checkIn: string, status: "inquiry" | "confirmed" = "inquiry") {
  const result = await createBooking({
    propertyId: property.id,
    guestId,
    checkIn,
    checkOut: addDays(checkIn, 4),
    status,
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

const pay = (id: string, input: Partial<PaymentInput>) =>
  recordPayment(
    id,
    {
      kind: "deposit",
      method: "bank_transfer",
      amountMinor: 0,
      receivedOn: day(1),
      note: null,
      ...input,
    },
    new Date(`${day(2)}T12:00:00Z`),
  );

const status = async (id: string) => (await db.booking.findUniqueOrThrow({ where: { id } })).status;
const ledger = (bookingId: string) =>
  db.transaction
    .findMany({
      where: { bookingId },
      include: { category: { select: { systemKey: true } } },
      orderBy: { createdAt: "asc" },
    })
    .then((rows) =>
      rows.map(
        (r) =>
          `${r.type} ${r.category.systemKey} ${r.amountMinor}${r.generated ? " generated" : ""}`,
      ),
    );
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
      defaultNightlyRateMinor: 25_000,
      defaultCleaningFeeMinor: 10_000,
    },
  });
  // The #80 income automation, on.
  await db.incomeAutomation.create({ data: { propertyId: property.id } });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.bookingPayment.deleteMany();
  await db.booking.deleteMany();
  await db.bankDetails.deleteMany();
});

describe("recording payments", () => {
  it("confirms a reservation once its deposit is in, and marks it paid once all is", async () => {
    const { id } = await booking(day(60));
    await reserveBooking(id, NOW);
    // 20% of 1100.00 = 220.00. A part of it moves nothing.
    expect(await pay(id, { amountMinor: 15_000 })).toMatchObject({
      booking: { status: "reserved" },
    });
    expect(await pay(id, { amountMinor: 7_000 })).toMatchObject({
      booking: { status: "confirmed" },
    });
    expect(await pay(id, { kind: "balance", amountMinor: 50_000 })).toMatchObject({
      booking: { status: "confirmed" },
    });
    expect(await pay(id, { kind: "balance", amountMinor: 38_000 })).toMatchObject({
      booking: { status: "paid" },
    });
    expect(await kinds(id)).toEqual(["reserved", "deposit_received", "fully_paid"]);
  });

  it("takes a short-notice reservation straight to paid with the full amount", async () => {
    const { id } = await booking(day(10));
    await reserveBooking(id, NOW);
    expect(await pay(id, { kind: "full", amountMinor: 110_000 })).toMatchObject({
      booking: { status: "paid" },
    });
    expect(await kinds(id)).toEqual(["reserved", "fully_paid"]);
  });

  it("is refused for an inquiry, a day still to come, and a refund beyond what came in", async () => {
    const { id } = await booking(day(60));
    expect(await pay(id, { amountMinor: 100 })).toEqual({
      error: "invalid",
      field: "kind",
      message: NOT_PAYABLE,
    });
    await reserveBooking(id, NOW);
    expect(await pay(id, { amountMinor: 100, receivedOn: day(3) })).toEqual({
      error: "invalid",
      field: "receivedOn",
      message: IN_THE_FUTURE,
    });
    await pay(id, { amountMinor: 5_000 });
    expect(await pay(id, { kind: "refund", amountMinor: 5_001 })).toEqual({
      error: "invalid",
      field: "amountMinor",
      message: MORE_THAN_RECEIVED,
    });
  });
});

describe("the ledger", () => {
  it("shows each payment exactly once, in place of the generated income", async () => {
    // Confirmed by hand: #80 generated its two entries.
    const { id } = await booking(day(60), "confirmed");
    expect(await ledger(id)).toEqual([
      "income booking_income 100000 generated",
      "income cleaning_fees 10000 generated",
    ]);

    await pay(id, { kind: "full", amountMinor: 110_000 });
    expect(await ledger(id)).toEqual(["income booking_income 110000"]);
    expect(await status(id)).toBe("paid");

    // Later edits generate nothing again.
    await updateBooking(id, { notes: "Late arrival" });
    expect(await ledger(id)).toEqual(["income booking_income 110000"]);
  });

  it("enters a refund as negative income, and takes a payment back with its entry", async () => {
    const { id } = await booking(day(60));
    await reserveBooking(id, NOW);
    const deposit = await pay(id, { amountMinor: 22_000 });
    await pay(id, { kind: "refund", amountMinor: 2_000, note: "Bank fee returned" });
    expect(await ledger(id)).toEqual([
      "income booking_income 22000",
      "income booking_income -2000",
    ]);
    // Revenue is net of the refund; nothing is a cost.
    const entries = await db.transaction.findMany({ where: { bookingId: id } });
    expect(entries.every((e) => e.type === "income")).toBe(true);
    expect(entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(20_000);
    // Its entry follows the payment, not a hand edit.
    expect(await updateTransaction(entries[1]!.id, { amountMinor: 100 })).toEqual({
      error: "invalid",
      field: "_",
      message: FROM_PAYMENT,
    });

    if (!("payment" in deposit)) throw new Error("not recorded");
    expect(await deletePayment(id, deposit.payment.id)).toBe(true);
    expect(await ledger(id)).toEqual(["income booking_income -2000"]);
    // The status stays: the owner decides.
    expect(await status(id)).toBe("confirmed");
    expect(await deletePayment(id, deposit.payment.id)).toBe(false);
  });

  it("gives the booking its generated income back when its last payment is taken back (GitLab #137)", async () => {
    const { id } = await booking(day(60), "confirmed");
    const first = await pay(id, { amountMinor: 22_000 });
    const second = await pay(id, { amountMinor: 30_000, receivedOn: day(2) });
    if (!("payment" in first) || !("payment" in second)) throw new Error("not recorded");

    // One payment left: its entry alone is the income.
    await deletePayment(id, second.payment.id);
    expect(await ledger(id)).toEqual(["income booking_income 22000"]);

    // None left: the automation's entries are back, once each.
    await deletePayment(id, first.payment.id);
    expect(await ledger(id)).toEqual([
      "income booking_income 100000 generated",
      "income cleaning_fees 10000 generated",
    ]);
  });
});

describe("the guest's link", () => {
  it("opens the booking by a token kept only as a hash", async () => {
    const { id } = await booking(day(60));
    const token = await issueGuestToken(id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await bookingForToken(token)).toBe(id);
    const stored = await db.guestAccessToken.findMany({ where: { bookingId: id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(token);
    expect(await bookingForToken(`${token.slice(0, 21)}x`)).toBeNull();
    expect(await bookingForToken("not a token")).toBeNull();
    // Never the reference.
    await reserveBooking(id, NOW);
    const { reference } = await db.booking.findUniqueOrThrow({ where: { id } });
    expect(reference).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(await bookingForToken(reference!)).toBeNull();
  });

  it("shows what is still to pay, to whom, with a GiroCode", async () => {
    const { id } = await booking(day(60));
    await reserveBooking(id, NOW);
    await pay(id, { amountMinor: 2_000 });
    const token = await issueGuestToken(id);

    // No bank details yet: the amount, but nothing to transfer to.
    expect(await guestView(token)).toMatchObject({
      status: "reserved",
      next: { kind: "deposit", amountMinor: 20_000, dueOn: day(7) },
      transfer: null,
    });

    await saveBankDetails(property.id, {
      accountHolder: "Ada Lovelace",
      iban: "DE89370400440532013000",
      bic: null,
      bankName: null,
    });
    const view = await guestView(token);
    expect(view).toMatchObject({
      receivedMinor: 2_000,
      transfer: {
        iban: "DE89 3704 0044 0532 0130 00",
        remittance: expect.stringMatching(/^Booking [A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/),
        girocode: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      },
    });
    expect(JSON.stringify(view)).not.toMatch(/Ada"|notes/);
  });

  it("says what became of a request, for the guest's help (GitLab #127)", async () => {
    const request = await booking(day(80));
    const token = await issueGuestToken(request.id);
    // Answered by the request settings' days (3 by default) after it came in.
    expect(await guestView(token)).toMatchObject({
      status: "inquiry",
      declined: false,
      wasReserved: false,
      answerBy: addDays(todayIn(property.timezone), 3),
    });
    await declineRequest(request.id, "Taken");
    expect(await guestView(token)).toMatchObject({
      status: "cancelled",
      declined: true,
      wasReserved: false,
      answerBy: null,
    });
    // The reason stays the owner's.
    expect(JSON.stringify(await guestView(token))).not.toContain("Taken");

    const reserved = await booking(day(100));
    await reserveBooking(reserved.id, NOW);
    expect(await guestView(await issueGuestToken(reserved.id))).toMatchObject({
      status: "reserved",
      declined: false,
      wasReserved: true,
      answerBy: null,
    });
  });
});
