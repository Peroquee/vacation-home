/**
 * Booking income on by default, and the switch (GitLab #137): the migration
 * that turns it on for existing properties, new properties, and what
 * switching it on (a backfill) and off (the untouched entries go) does to
 * the ledger, through the API and `npm run income:backfill`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  GET as getSettings,
  PUT as putSettings,
} from "@/app/api/properties/[id]/income-automation/route";
import { PATCH as patchTransaction } from "@/app/api/transactions/[id]/route";
import { cancelBooking, createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { recordPayment } from "@/lib/payments/service";
import { createProperty } from "@/lib/properties/service";

import { runIncomeBackfill } from "./income-backfill";

let propertyId: string;
let guestId: string;

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (body: unknown, id = propertyId) =>
  putSettings(
    new Request("http://localhost/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(id),
  );
const get = async (id = propertyId) =>
  (await getSettings(new Request("http://localhost/x"), context(id))).json();

let nextCheckIn = 1;
/** 3 nights at 100 + 40 cleaning: 340, each booking on its own dates. */
async function book(status: "confirmed" | "inquiry" = "confirmed") {
  const day = String(nextCheckIn).padStart(2, "0");
  nextCheckIn += 4;
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn: `2026-11-${day}`,
    checkOut: `2026-11-${String(Number(day) + 3).padStart(2, "0")}`,
    status,
    source: "airbnb",
    guestCount: 2,
    nightlyRateMinor: 100_00,
    cleaningFeeMinor: 40_00,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

/** The booking's ledger, as "kind amount" ("hand" for an entry typed in). */
const ledger = async (bookingId: string) =>
  (
    await db.transaction.findMany({
      where: { bookingId },
      orderBy: [{ generated: "asc" }, { createdAt: "asc" }],
    })
  ).map(
    (t) =>
      `${t.generated ?? (t.paymentId ? "payment" : "hand")} ${t.amountMinor}${t.detachedAt ? " detached" : ""}`,
  );

async function handIncome(
  bookingId: string | null,
  amountMinor: number,
  systemKey = "booking_income",
) {
  const category = await db.category.findUniqueOrThrow({ where: { systemKey } });
  return db.transaction.create({
    data: {
      propertyId,
      bookingId,
      type: "income",
      categoryId: category.id,
      amountMinor,
      currency: "EUR",
      date: new Date("2026-11-02T00:00:00Z"),
      description: "Airbnb payout",
    },
  });
}

beforeEach(async () => {
  nextCheckIn = 1;
  await db.transaction.deleteMany();
  await db.bookingPayment.deleteMany();
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  // Made directly, as before #137: no settings row, so off.
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  guestId = (await db.guest.create({ data: { name: "Ada Lovelace" } })).id;
});

afterAll(async () => {
  await db.transaction.deleteMany();
  await db.$disconnect();
});

describe("on by default", () => {
  it("for a new property", async () => {
    const property = await createProperty({
      name: "Sea view",
      timezone: "Europe/Berlin",
      currency: "EUR",
      defaultNightlyRateMinor: 0,
      defaultCleaningFeeMinor: 0,
      color: "#0f766e",
      publiclyListed: false,
    });
    if (typeof property === "string") throw new Error(property);
    expect(await get(property.id)).toEqual({ enabled: true, onCancel: "delete" });
  });

  it("for existing properties, by the migration, which keeps one switched off by hand", async () => {
    const off = (
      await db.property.create({
        data: { name: "Off on purpose", timezone: "UTC", currency: "EUR", color: "#0f766e" },
      })
    ).id;
    await db.incomeAutomation.create({
      data: { propertyId: off, enabled: false, onCancel: "zero" },
    });

    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20261025040000_income_automation_on/migration.sql"),
      "utf8",
    );
    await db.$executeRawUnsafe(migration);
    // Running it twice changes nothing.
    await db.$executeRawUnsafe(migration);

    expect(await get()).toEqual({ enabled: true, onCancel: "delete" });
    expect(await get(off)).toEqual({ enabled: false, onCancel: "zero" });
  });
});

describe("switching it on", () => {
  it("brings in the bookings already confirmed, once, beside payments and hand-typed income", async () => {
    const plain = await book();
    const inquiry = await book("inquiry");
    const cancelled = await book();
    await cancelBooking(cancelled.id);
    const paid = await book();
    const payment = await recordPayment(paid.id, {
      kind: "deposit",
      method: "bank_transfer",
      amountMinor: 100_00,
      receivedOn: "2026-10-01",
      note: null,
    });
    expect(payment).toHaveProperty("payment");
    // Income the owner typed in by hand and linked to the booking.
    const typed = await book();
    await handIncome(typed.id, 340_00);

    const response = await put({ enabled: true, onCancel: "delete" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      onCancel: "delete",
      added: 2,
      removed: 0,
    });

    expect(await ledger(plain.id)).toEqual([
      "booking_accommodation 30000",
      "booking_cleaning 4000",
    ]);
    expect(await ledger(inquiry.id)).toEqual([]);
    expect(await ledger(cancelled.id)).toEqual([]);
    expect(await ledger(paid.id)).toEqual(["payment 10000"]);
    expect(await ledger(typed.id)).toEqual(["hand 34000"]);

    // Saving it again, still on, adds nothing.
    expect(await (await put({ enabled: true, onCancel: "delete" })).json()).toMatchObject({
      added: 0,
    });
    expect(await ledger(plain.id)).toHaveLength(2);
  });
});

describe("switching it off", () => {
  it("takes out the untouched generated entries, and leaves edited, paid and typed ones", async () => {
    await put({ enabled: true, onCancel: "delete" });
    const plain = await book();
    const edited = await book();
    const [accommodation] = await db.transaction.findMany({
      where: { bookingId: edited.id, generated: "booking_accommodation" },
    });
    const patched = await patchTransaction(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountMinor: 280_00 }),
      }),
      context(accommodation!.id),
    );
    expect(patched.status).toBe(200);
    const unlinked = await handIncome(null, 99_00);

    const response = await put({ enabled: false, onCancel: "delete" });
    expect(await response.json()).toEqual({
      enabled: false,
      onCancel: "delete",
      added: 0,
      removed: 3,
    });
    expect(await ledger(plain.id)).toEqual([]);
    expect(await ledger(edited.id)).toEqual(["booking_accommodation 28000 detached"]);
    expect(await db.transaction.findUnique({ where: { id: unlinked.id } })).not.toBeNull();

    // And on again: back, without doubling the edited one.
    expect(await (await put({ enabled: true, onCancel: "delete" })).json()).toMatchObject({
      added: 3,
    });
    expect(await ledger(plain.id)).toEqual([
      "booking_accommodation 30000",
      "booking_cleaning 4000",
    ]);
    expect(await ledger(edited.id)).toEqual([
      "booking_accommodation 28000 detached",
      "booking_cleaning 4000",
    ]);
  });
});

describe("npm run income:backfill", () => {
  /** As the migration leaves an existing property: on, nothing backfilled. */
  const migratedOn = (enabled = true) =>
    db.incomeAutomation.create({ data: { propertyId, enabled } });

  it("only reports on a dry run, with the hand-typed income not linked to a booking", async () => {
    const plain = await book();
    await handIncome(null, 340_00);
    await handIncome(null, 40_00, "cleaning_fees");
    await migratedOn();

    const [report] = await runIncomeBackfill({ apply: false });
    expect(report).toMatchObject({
      propertyId,
      name: "Lake house",
      enabled: true,
      bookings: 1,
      entries: 2,
      amountMinor: 340_00,
      skipped: 0,
    });
    expect(report!.unlinked).toEqual([
      expect.objectContaining({ category: "Booking income", count: 1, amountMinor: 340_00 }),
      expect.objectContaining({ category: "Cleaning fees", count: 1, amountMinor: 40_00 }),
    ]);
    expect(await ledger(plain.id)).toEqual([]);
  });

  it("creates the entries with --apply, and a second run finds nothing to do", async () => {
    const plain = await book();
    const typed = await book();
    await handIncome(typed.id, 340_00);
    await migratedOn();

    expect(await runIncomeBackfill({ apply: true })).toEqual([
      expect.objectContaining({ bookings: 1, entries: 2, skipped: 1 }),
    ]);
    expect(await ledger(plain.id)).toEqual([
      "booking_accommodation 30000",
      "booking_cleaning 4000",
    ]);
    expect(await ledger(typed.id)).toEqual(["hand 34000"]);

    expect(await runIncomeBackfill({ apply: true })).toEqual([
      expect.objectContaining({ bookings: 0, entries: 0, skipped: 1 }),
    ]);
    expect(await ledger(plain.id)).toHaveLength(2);
  });

  it("leaves a property alone whose income automation is off", async () => {
    const plain = await book();
    await migratedOn(false);
    expect(await runIncomeBackfill({ apply: true })).toEqual([
      expect.objectContaining({ enabled: false, bookings: 0, entries: 0 }),
    ]);
    expect(await ledger(plain.id)).toEqual([]);
  });
});
