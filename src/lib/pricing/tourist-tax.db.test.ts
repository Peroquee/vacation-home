/**
 * The Kurtaxe against a real PostgreSQL (GitLab #120): it follows the
 * guests by the rules the booking was priced under, can be set by hand,
 * stays out of the deposit, and is booked - and refunded - in its own
 * pass-through category, which no revenue figure counts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Property } from "@/generated/prisma/client";
import { getAnalytics } from "@/lib/analytics/service";
import { reserveBooking } from "@/lib/bookings/hold";
import { breakdownOf, createBooking, updateBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";
import { touristTaxReport } from "@/lib/finance/tourist-tax-report";
import { savePaymentTerms } from "@/lib/payment-terms/service";
import { DEFAULT_TERMS } from "@/lib/payment-terms/terms";
import { recordPayment } from "@/lib/payments/service";

import { saveTouristTax } from "./service";
import type { TouristTaxRules } from "./tourist-tax";

let property: Property;
let guestId: string;
const NOW = new Date("2026-07-01T12:00:00Z");

/** 3.00 per adult and night, children 6-15 1.50, under 6 free. */
const RULES: TouristTaxRules = {
  adultRateMinor: 300,
  childGroups: [
    { fromAge: 0, toAge: 5, rateMinor: 0 },
    { fromAge: 6, toAge: 15, rateMinor: 150 },
  ],
  periods: [],
  maxNights: null,
  included: false,
};
const FAMILY = {
  adults: 2,
  children: [
    { fromAge: 0, toAge: 5, count: 1 },
    { fromAge: 6, toAge: 15, count: 1 },
  ],
};
// 4 nights at 100.00 + 50.00 cleaning; Kurtaxe 2 x 4 x 3.00 + 4 x 1.50 = 30.00.
const STAY = { checkIn: "2026-09-10", checkOut: "2026-09-14" };

async function booking(extra: Record<string, unknown> = {}) {
  const made = await createBooking({
    propertyId: property.id,
    guestId,
    ...STAY,
    status: "confirmed",
    source: "direct",
    guestSplit: FAMILY,
    ...extra,
  });
  if (!("booking" in made)) throw new Error(JSON.stringify(made));
  return made.booking;
}

async function pay(bookingId: string, kind: "deposit" | "balance" | "refund", amountMinor: number) {
  const result = await recordPayment(
    bookingId,
    { kind, method: "bank_transfer", amountMinor, receivedOn: "2026-07-01", note: null },
    NOW,
  );
  if (!("payment" in result)) throw new Error(JSON.stringify(result));
}

/** A booking's ledger entries as [category, amount], in a stable order. */
const ledger = async (bookingId: string) =>
  (
    await db.transaction.findMany({
      where: { bookingId },
      select: { amountMinor: true, category: { select: { systemKey: true } } },
    })
  )
    .map((e) => [e.category.systemKey ?? "", e.amountMinor] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));

beforeAll(async () => {
  property = await db.property.create({
    data: {
      name: "Lake House",
      timezone: "Europe/Berlin",
      currency: "EUR",
      color: "#0f766e",
      defaultNightlyRateMinor: 10_000,
      defaultCleaningFeeMinor: 5_000,
    },
  });
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.bookingPayment.deleteMany();
  await db.bookingEvent.deleteMany();
  await db.booking.deleteMany();
  await db.paymentTerms.deleteMany();
  await db.incomeAutomation.deleteMany();
  await saveTouristTax(property.id, RULES);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("a booking's Kurtaxe", () => {
  it("is worked out for its guests by age group, and guestCount is their sum", async () => {
    const made = await booking();
    expect(made).toMatchObject({
      guestCount: 4,
      guestSplit: FAMILY,
      touristTaxMinor: 3_000,
      totalAmountMinor: 40_000 + 5_000 + 3_000,
    });
    expect(breakdownOf(made)).toMatchObject({ touristTax: { amountMinor: 3_000 } });
  });

  it("follows a change of guests by the rules it was priced under, nothing else moving", async () => {
    const made = await booking();
    // The municipality doubles its rates; and a season would change nothing either.
    await saveTouristTax(property.id, { ...RULES, adultRateMinor: 600 });
    const changed = await updateBooking(made.id, { guestSplit: { adults: 3, children: [] } });
    if (!("booking" in changed)) throw new Error(JSON.stringify(changed));
    // 3 x 4 x 3.00, by the old rules.
    expect(changed.booking).toMatchObject({ guestCount: 3, touristTaxMinor: 3_600 });
    const before = breakdownOf(made);
    const after = breakdownOf(changed.booking);
    if (before.kind !== "computed" || after.kind !== "computed") throw new Error("legacy");
    expect(after.nights).toEqual(before.nights);
    expect(after.cleaningFeeMinor).toBe(before.cleaningFeeMinor);
    expect(changed.booking.totalAmountMinor).toBe(45_000 + 3_600);
  });

  it("can be set by hand for the booking, with a note, and handed back to the rules", async () => {
    const made = await booking({ touristTaxMinor: 0, touristTaxNote: "Dienstreise" });
    expect(made).toMatchObject({
      touristTaxMinor: 0,
      touristTaxManualMinor: 0,
      touristTaxNote: "Dienstreise",
      totalAmountMinor: 45_000,
    });
    expect(breakdownOf(made)).toMatchObject({
      touristTax: { amountMinor: 0, manual: { note: "Dienstreise" } },
    });
    // Editing anything else keeps it.
    const noted = await updateBooking(made.id, { notes: "Late arrival" });
    if (!("booking" in noted)) throw new Error(JSON.stringify(noted));
    expect(noted.booking.touristTaxManualMinor).toBe(0);
    const back = await updateBooking(made.id, { touristTaxMinor: null });
    if (!("booking" in back)) throw new Error(JSON.stringify(back));
    expect(back.booking).toMatchObject({
      touristTaxMinor: 3_000,
      touristTaxManualMinor: null,
      touristTaxNote: null,
      totalAmountMinor: 48_000,
    });
  });

  it("is left out of the deposit: it is paid with the balance", async () => {
    await savePaymentTerms(property.id, { ...DEFAULT_TERMS, depositPercent: 30 });
    const inquiry = await booking({ status: "inquiry" });
    const reserved = await reserveBooking(inquiry.id, NOW);
    if (!("booking" in reserved)) throw new Error(JSON.stringify(reserved));
    // 30% of 450.00, not of 480.00.
    expect(reserved.booking.depositAmountMinor).toBe(13_500);
    expect(reserved.booking.cancellationPolicy).toMatchObject({ depositAmountMinor: 13_500 });
  });
});

describe("the Kurtaxe in the books", () => {
  it("is entered as it comes in, in the pass-through category, and refunded first", async () => {
    await savePaymentTerms(property.id, { ...DEFAULT_TERMS, depositPercent: 30 });
    const inquiry = await booking({ status: "inquiry" });
    await reserveBooking(inquiry.id, NOW);
    await pay(inquiry.id, "deposit", 13_500);
    // The balance holds the rest of the stay and the 30.00 Kurtaxe.
    await pay(inquiry.id, "balance", 34_500);
    expect(await ledger(inquiry.id)).toEqual([
      ["booking_income", 13_500],
      ["booking_income", 31_500],
      ["tourist_tax", 3_000],
    ]);

    // A refund gives the Kurtaxe back before anything else.
    await pay(inquiry.id, "refund", 5_000);
    expect(await ledger(inquiry.id)).toEqual([
      ["booking_income", -2_000],
      ["booking_income", 13_500],
      ["booking_income", 31_500],
      ["tourist_tax", -3_000],
      ["tourist_tax", 3_000],
    ]);
  });

  it("gets its own entry from the income automation", async () => {
    await db.incomeAutomation.create({ data: { propertyId: property.id } });
    const made = await booking();
    expect(
      await db.transaction.findMany({
        where: { bookingId: made.id },
        select: { generated: true, amountMinor: true },
        orderBy: { generated: "asc" },
      }),
    ).toEqual([
      { generated: "booking_accommodation", amountMinor: 40_000 },
      { generated: "booking_cleaning", amountMinor: 5_000 },
      { generated: "booking_tourist_tax", amountMinor: 3_000 },
    ]);
  });

  it("is no revenue on the dashboard, and the Kurtaxe report sums it per month", async () => {
    await db.incomeAutomation.create({ data: { propertyId: property.id } });
    await booking();
    const result = await getAnalytics({
      from: "2026-09-01",
      to: "2026-10-01",
      propertyId: property.id,
      compare: "year",
      excludeBlocks: true,
    });
    if (!("report" in result)) throw new Error(JSON.stringify(result));
    expect(result.report.totals.incomeMinor).toBe(45_000);

    const [eur] = await touristTaxReport(2026, property.id);
    expect(eur?.currency).toBe("EUR");
    expect(eur?.months[8]).toEqual({
      month: "2026-09",
      owedMinor: 3_000,
      stays: 1,
      collectedMinor: 3_000,
    });
    expect(eur?.months.filter((m) => m.owedMinor > 0)).toHaveLength(1);
  });
});
