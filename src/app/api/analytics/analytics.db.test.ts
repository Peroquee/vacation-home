/**
 * The analytics API against a real PostgreSQL: a small fixed dataset whose
 * every figure is worked out by hand below, and the seeded demo data for
 * the response-time requirement.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/analytics/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { buildSeedPlan } from "@/lib/seed/plan";

let lake: string;
let sea: string;
let guestId: string;
const category = async (systemKey: string) =>
  (await db.category.findUniqueOrThrow({ where: { systemKey } })).id;

async function analytics(query: string) {
  const response = await GET(new Request(`http://localhost/api/analytics?${query}`));
  return { status: response.status, body: await response.json() };
}

async function reset() {
  await db.transaction.deleteMany();
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
}

const booking = (
  propertyId: string,
  checkIn: string,
  checkOut: string,
  total: number,
  cleaning: number,
  status: "confirmed" | "inquiry" | "cancelled" = "confirmed",
) =>
  db.booking.create({
    data: {
      propertyId,
      guestId,
      checkIn: toUtcDate(checkIn),
      checkOut: toUtcDate(checkOut),
      status,
      nightlyRateMinor: 0,
      cleaningFeeMinor: cleaning,
      totalAmountMinor: total,
      currency: "EUR",
    },
  });
const entry = async (propertyId: string, date: string, systemKey: string, amountMinor: number) =>
  db.transaction.create({
    data: {
      propertyId,
      type: ["booking_income", "cleaning_fees", "other_income"].includes(systemKey)
        ? "income"
        : "expense",
      categoryId: await category(systemKey),
      amountMinor,
      currency: "EUR",
      date: toUtcDate(date),
    },
  });

afterAll(() => db.$disconnect());

describe("a fixed dataset", () => {
  beforeEach(async () => {
    await reset();
    const property = (name: string) =>
      db.property.create({ data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e" } });
    lake = (await property("Lake house")).id;
    sea = (await property("Sea cottage")).id;
    guestId = (await db.guest.create({ data: { name: "Ada" } })).id;

    // Lake, 2026: 5 nights Jan 29 - Feb 3 (accommodation 500 - 50 = 450:
    // 90 a night, 3 in Jan, 2 in Feb); 4 nights Mar 10 - 14 (400, no fee).
    await booking(lake, "2026-01-29", "2026-02-03", 500_00, 50_00);
    await booking(lake, "2026-03-10", "2026-03-14", 400_00, 0);
    // Neither counts: an inquiry and a cancelled stay.
    await booking(lake, "2026-02-10", "2026-02-12", 999_00, 0, "inquiry");
    await booking(lake, "2026-02-20", "2026-02-22", 999_00, 0, "cancelled");
    // Owner block on the Lake: Feb 15 - 20, 5 nights.
    await db.block.create({
      data: {
        propertyId: lake,
        startDate: toUtcDate("2026-02-15"),
        endDate: toUtcDate("2026-02-20"),
      },
    });
    // Sea, 2026: 2 nights Feb 27 - Mar 1 (300 - 100 = 200: 100 a night).
    await booking(sea, "2026-02-27", "2026-03-01", 300_00, 100_00);
    // A year earlier, for the comparison: Lake 3 nights in Feb 2025 (300).
    await booking(lake, "2025-02-01", "2025-02-04", 300_00, 0);

    await entry(lake, "2026-01-29", "booking_income", 450_00);
    await entry(lake, "2026-01-29", "cleaning_fees", 50_00);
    await entry(lake, "2026-02-05", "maintenance", 120_00);
    await entry(lake, "2026-03-01", "utilities", 80_00);
    await entry(sea, "2026-02-27", "booking_income", 200_00);
    await entry(sea, "2026-03-31", "utilities", 40_00);
    // Outside the range.
    await entry(lake, "2026-04-01", "booking_income", 999_00);
    await entry(lake, "2025-02-01", "booking_income", 300_00);
  });

  it("gives monthly series, totals and rates, worked out by hand", async () => {
    // January to March 2026, both properties.
    const { status, body } = await analytics("from=2026-01-01&to=2026-04-01");
    expect(status).toBe(200);
    expect(body.currency).toBe("EUR");
    expect(body.months).toEqual([
      {
        month: "2026-01",
        from: "2026-01-01",
        to: "2026-02-01",
        bookedNights: 3,
        blockedNights: 0,
        availableNights: 62, // 31 x 2
        accommodationRevenueMinor: 270_00, // 3 x 90
        incomeMinor: 500_00,
        expensesMinor: 0,
        netMinor: 500_00,
      },
      {
        month: "2026-02",
        from: "2026-02-01",
        to: "2026-03-01",
        bookedNights: 2 + 2, // Lake Feb 1-2, Sea Feb 27-28
        blockedNights: 5,
        availableNights: 28 * 2 - 5,
        accommodationRevenueMinor: 180_00 + 200_00,
        incomeMinor: 200_00,
        expensesMinor: 120_00,
        netMinor: 80_00,
      },
      {
        month: "2026-03",
        from: "2026-03-01",
        to: "2026-04-01",
        bookedNights: 4,
        blockedNights: 0,
        availableNights: 62,
        accommodationRevenueMinor: 400_00,
        incomeMinor: 0,
        expensesMinor: 120_00,
        netMinor: -120_00,
      },
    ]);
    expect(body.totals).toEqual({
      bookedNights: 11,
      blockedNights: 5,
      availableNights: 175, // 62 + 51 + 62
      accommodationRevenueMinor: 1050_00,
      incomeMinor: 700_00,
      expensesMinor: 240_00,
      netMinor: 460_00,
      occupancyRate: 0.0629, // 11 / 175
      averageNightlyRateMinor: 95_45, // 1050 / 11 = 95.4545...
      revenuePerAvailableNightMinor: 6_00, // 1050 / 175
    });
    expect(body.expensesByCategory).toEqual([
      {
        categoryId: await category("maintenance"),
        name: "Maintenance",
        color: "#db2777",
        amountMinor: 120_00,
        share: 0.5,
      },
      {
        categoryId: await category("utilities"),
        name: "Utilities",
        color: "#ea580c",
        amountMinor: 120_00,
        share: 0.5,
      },
    ]);
  });

  it("compares with the same period a year earlier", async () => {
    const { body } = await analytics("from=2026-01-01&to=2026-04-01");
    expect(body.prior).toMatchObject({ compare: "year", from: "2025-01-01", to: "2025-04-01" });
    // 2025: 31 + 28 + 31 = 90 nights x 2 properties; 3 booked; income 300.
    expect(body.prior.totals).toMatchObject({
      bookedNights: 3,
      availableNights: 180,
      accommodationRevenueMinor: 300_00,
      incomeMinor: 300_00,
      occupancyRate: 0.0167,
    });
    expect(body.change.incomeMinor).toEqual({ delta: 400_00, percent: 133.3 });
    expect(body.change.bookedNights).toEqual({ delta: 8, percent: 266.7 });
  });

  it("filters to one property, clips partial months, and can keep blocks in the denominator", async () => {
    // Lake only, Jan 30 - Feb 18: Jan 30-31 (2 nights) and Feb 1-17 (17).
    const { body } = await analytics(
      `propertyId=${lake}&from=2026-01-30&to=2026-02-18&compare=previous`,
    );
    expect(
      body.months.map((m: { month: string; from: string; to: string }) => [m.month, m.from, m.to]),
    ).toEqual([
      ["2026-01", "2026-01-30", "2026-02-01"],
      ["2026-02", "2026-02-01", "2026-02-18"],
    ]);
    expect(body.totals).toMatchObject({
      bookedNights: 4, // Jan 30, 31, Feb 1, 2
      blockedNights: 3, // Feb 15, 16, 17
      availableNights: 19 - 3,
      accommodationRevenueMinor: 360_00,
    });
    expect(body.prior).toMatchObject({ compare: "previous", from: "2026-01-11", to: "2026-01-30" });

    const withBlocks = await analytics(
      `propertyId=${lake}&from=2026-01-30&to=2026-02-18&excludeBlocks=false`,
    );
    expect(withBlocks.body.totals).toMatchObject({ availableNights: 19 });
    expect(withBlocks.body.excludeBlocks).toBe(false);
  });

  it("refuses to add up different currencies", async () => {
    await db.property.create({
      data: { name: "Chalet", timezone: "UTC", currency: "CHF", color: "#0f766e" },
    });
    const { status, body } = await analytics("from=2026-01-01&to=2026-04-01");
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ reason: "mixed_currencies", currencies: ["CHF", "EUR"] });
  });

  it("rejects an invalid query, and 404s an unknown property", async () => {
    expect((await analytics("from=2026-01-01")).status).toBe(422);
    expect((await analytics("from=2026-02-01&to=2026-01-01")).status).toBe(422);
    expect((await analytics("from=2026-13-01&to=x")).status).toBe(422);
    expect((await analytics("from=2020-01-01&to=2026-01-01")).body.error.fields.to).toEqual([
      "the range can be at most 1098 days",
    ]);
    expect((await analytics("from=2026-01-01&to=2026-02-01&compare=decade")).status).toBe(422);
    expect(
      (await analytics(`from=2026-01-01&to=2026-02-01&propertyId=${crypto.randomUUID()}`)).status,
    ).toBe(404);
  });
});

describe("the seeded demo data", () => {
  it("answers a twelve-month query in under 300 ms", async () => {
    await reset();
    const plan = buildSeedPlan();
    const ids = new Map<string, string>();
    // All in EUR, so the query covers every property at once (mixed
    // currencies are refused, tested above).
    for (const { key, ...property } of plan.properties) {
      ids.set(key, (await db.property.create({ data: { ...property, currency: "EUR" } })).id);
    }
    guestId = (await db.guest.create({ data: { name: "Seed guest" } })).id;
    for (const b of plan.bookings) {
      await db.booking.create({
        data: {
          propertyId: ids.get(b.property)!,
          guestId,
          checkIn: toUtcDate(b.checkIn),
          checkOut: toUtcDate(b.checkOut),
          status: b.status,
          nightlyRateMinor: b.nightlyRateMinor,
          cleaningFeeMinor: b.cleaningFeeMinor,
          totalAmountMinor: b.totalAmountMinor,
          currency: "EUR",
        },
      });
    }
    await db.block.createMany({
      data: plan.blocks.map((b) => ({
        propertyId: ids.get(b.property)!,
        startDate: toUtcDate(b.startDate),
        endDate: toUtcDate(b.endDate),
        origin: b.origin,
        externalEventId: b.externalEventId,
      })),
    });
    // A busy ledger: three entries a day across the year, per property.
    const utilities = await category("utilities");
    const rows = [];
    for (const [, propertyId] of ids) {
      for (let day = 0; day < 365; day++) {
        const date = new Date(Date.UTC(2026, 0, 1 + day));
        for (let i = 0; i < 3; i++) {
          rows.push({
            propertyId,
            type: "expense" as const,
            categoryId: utilities,
            amountMinor: 1_00 + i,
            currency: "EUR",
            date,
          });
        }
      }
    }
    await db.transaction.createMany({ data: rows });

    const query = "from=2026-01-01&to=2027-01-01";
    expect((await analytics(query)).status).toBe(200); // warm-up
    const started = performance.now();
    const { status, body } = await analytics(query);
    const elapsed = performance.now() - started;
    expect(status).toBe(200);
    expect(body.months).toHaveLength(12);
    expect(body.totals.bookedNights).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(300);
  });
});
