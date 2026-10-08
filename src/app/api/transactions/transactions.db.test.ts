/**
 * The transaction API (GitLab #77) through its route handlers, against
 * PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET as getOne, PATCH } from "@/app/api/transactions/[id]/route";
import { POST as bulkDelete } from "@/app/api/transactions/bulk-delete/route";
import { GET as list, POST as create } from "@/app/api/transactions/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { systemCategory } from "@/lib/finance/categories";

const BASE = "http://localhost/api/transactions";
let lake: string;
let cabin: string;
let lakeBooking: string;
let cabinBooking: string;
const cat: Record<string, string> = {};

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function post(body: Record<string, unknown>) {
  const response = await create(new Request(BASE, send("POST", body)));
  return { status: response.status, body: await response.json() };
}
async function query(params: string) {
  const response = await list(new Request(`${BASE}?${params}`));
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const property = (name: string) =>
    db.property.create({ data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e" } });
  lake = (await property("Lake House")).id;
  cabin = (await property("Mountain Cabin")).id;
  const guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
  const booking = async (propertyId: string) =>
    (
      await db.booking.create({
        data: {
          propertyId,
          guestId,
          checkIn: toUtcDate("2026-07-14"),
          checkOut: toUtcDate("2026-07-18"),
          nightlyRateMinor: 10_000,
          cleaningFeeMinor: 5_000,
          totalAmountMinor: 45_000,
          currency: "EUR",
        },
      })
    ).id;
  lakeBooking = await booking(lake);
  cabinBooking = await booking(cabin);
  for (const key of ["booking_income", "cleaning_fees", "cleaning", "maintenance", "utilities"]) {
    cat[key] = (await systemCategory(key)).id;
  }
});

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.category.updateMany({ where: { isSystem: true }, data: { hidden: false } });
});

afterAll(async () => {
  await db.transaction.deleteMany();
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany({ where: { id: { in: [lake, cabin] } } });
  await db.$disconnect();
});

describe("POST /api/transactions", () => {
  it("records a transaction in the property's currency, with or without a booking", async () => {
    const plain = await post({
      propertyId: lake,
      type: "expense",
      categoryId: cat.maintenance,
      amountMinor: 12_345,
      date: "2026-07-20",
      description: "Fixed the tap",
    });
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({
      currency: "EUR",
      amountMinor: 12_345,
      date: "2026-07-20",
      bookingId: null,
      isRecurring: false,
      category: { id: cat.maintenance, name: "Maintenance" },
    });

    const linked = await post({
      propertyId: lake,
      type: "income",
      categoryId: cat.booking_income,
      amountMinor: 40_000,
      date: "2026-07-14",
      bookingId: lakeBooking,
    });
    expect(linked.body.bookingId).toBe(lakeBooking);
  });

  it("names the field when a reference does not fit", async () => {
    const base = {
      propertyId: lake,
      type: "expense",
      categoryId: cat.cleaning,
      amountMinor: 100,
      date: "2026-07-20",
    };
    const fields = async (body: Record<string, unknown>) =>
      (await post({ ...base, ...body })).body.error.fields;

    expect(await fields({ categoryId: cat.booking_income })).toEqual({
      categoryId: ["is not an expense category"],
    });
    expect(await fields({ bookingId: cabinBooking })).toEqual({
      bookingId: ["belongs to another property"],
    });
    expect(await fields({ propertyId: "00000000-0000-4000-8000-000000000000" })).toEqual({
      propertyId: ["does not exist"],
    });
    await db.property.update({ where: { id: cabin }, data: { archivedAt: new Date() } });
    try {
      expect(await fields({ propertyId: cabin, categoryId: cat.cleaning })).toEqual({
        propertyId: ["is archived"],
      });
    } finally {
      await db.property.update({ where: { id: cabin }, data: { archivedAt: null } });
    }

    await db.category.update({ where: { id: cat.cleaning }, data: { hidden: true } });
    expect(await fields({})).toEqual({ categoryId: ["is hidden"] });
  });

  it("validates amounts as positive whole minor units, and other fields", async () => {
    const bad = await post({
      propertyId: lake,
      type: "loss",
      categoryId: cat.cleaning,
      amountMinor: 12.5,
      date: "2026-13-01",
      currency: "USD",
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(["_", "amountMinor", "date", "type"]);
    const zero = await post({
      propertyId: lake,
      type: "expense",
      categoryId: cat.cleaning,
      amountMinor: 0,
      date: "2026-07-01",
    });
    expect(zero.body.error.fields.amountMinor[0]).toMatch(/positive/);
  });
});

describe("GET, PATCH and DELETE /api/transactions/:id", () => {
  it("reads, updates and deletes one transaction", async () => {
    const { body: tx } = await post({
      propertyId: lake,
      type: "expense",
      categoryId: cat.cleaning,
      amountMinor: 5_000,
      date: "2026-07-20",
    });
    expect(await (await getOne(new Request(BASE), context(tx.id))).json()).toEqual(tx);

    const patched = await PATCH(
      new Request(
        BASE,
        send("PATCH", { amountMinor: 5_500, description: "Deep clean", bookingId: lakeBooking }),
      ),
      context(tx.id),
    );
    expect(await patched.json()).toMatchObject({
      amountMinor: 5_500,
      description: "Deep clean",
      bookingId: lakeBooking,
    });

    expect((await DELETE(new Request(BASE), context(tx.id))).status).toBe(204);
    expect((await DELETE(new Request(BASE), context(tx.id))).status).toBe(404);
  });

  it("changes the type only together with a category of the new type", async () => {
    const { body: tx } = await post({
      propertyId: lake,
      type: "expense",
      categoryId: cat.cleaning,
      amountMinor: 5_000,
      date: "2026-07-20",
    });
    const patch = async (body: unknown) =>
      (await PATCH(new Request(BASE, send("PATCH", body)), context(tx.id))).json();

    expect((await patch({ type: "income" })).error.fields.categoryId[0]).toMatch(/required/);
    expect(
      (await patch({ type: "income", categoryId: cat.maintenance })).error.fields.categoryId,
    ).toEqual(["is not an income category"]);
    expect(await patch({ type: "income", categoryId: cat.cleaning_fees })).toMatchObject({
      type: "income",
      category: { id: cat.cleaning_fees },
    });
    expect((await patch({ propertyId: cabin })).error.fields._).toBeDefined();
  });
});

describe("GET /api/transactions: filter combinations", () => {
  type Row = {
    property: string;
    type: "income" | "expense";
    category: string;
    amount: number;
    date: string;
    booking?: string;
  };
  const rows: Row[] = [];

  beforeEach(async () => {
    rows.length = 0;
    const add = (row: Row) => rows.push(row);
    add({
      property: "lake",
      type: "income",
      category: "booking_income",
      amount: 40_000,
      date: "2026-07-14",
      booking: "lake",
    });
    add({
      property: "lake",
      type: "income",
      category: "cleaning_fees",
      amount: 5_000,
      date: "2026-07-14",
      booking: "lake",
    });
    add({
      property: "lake",
      type: "expense",
      category: "cleaning",
      amount: 3_000,
      date: "2026-07-18",
      booking: "lake",
    });
    add({
      property: "lake",
      type: "expense",
      category: "maintenance",
      amount: 25_000,
      date: "2026-08-02",
    });
    add({
      property: "lake",
      type: "expense",
      category: "utilities",
      amount: 7_777,
      date: "2026-06-30",
    });
    add({
      property: "cabin",
      type: "income",
      category: "booking_income",
      amount: 60_000,
      date: "2026-07-14",
      booking: "cabin",
    });
    add({
      property: "cabin",
      type: "expense",
      category: "utilities",
      amount: 9_100,
      date: "2026-07-01",
    });
    add({
      property: "cabin",
      type: "expense",
      category: "maintenance",
      amount: 1,
      date: "2026-08-31",
    });
    const ids = { lake, cabin };
    const bookings = { lake: lakeBooking, cabin: cabinBooking };
    for (const row of rows) {
      const { status } = await post({
        propertyId: ids[row.property as "lake" | "cabin"],
        type: row.type,
        categoryId: cat[row.category],
        amountMinor: row.amount,
        date: row.date,
        bookingId: row.booking ? bookings[row.booking as "lake" | "cabin"] : null,
      });
      expect(status).toBe(201);
    }
  });

  /** The same filters, applied by hand to the fixture. */
  const expected = (match: (row: Row) => boolean) =>
    rows
      .filter(match)
      .map((r) => r.amount)
      .sort((a, b) => a - b);
  const amounts = async (params: string) => {
    const { status, body } = await query(`${params}&pageSize=200`);
    expect(status, params).toBe(200);
    return (body.items as { amountMinor: number }[])
      .map((t) => t.amountMinor)
      .sort((a, b) => a - b);
  };

  const cases: [string, () => string, (row: Row) => boolean][] = [
    ["no filter", () => "", () => true],
    ["property", () => `propertyId=${lake}`, (r) => r.property === "lake"],
    ["type", () => "type=expense", (r) => r.type === "expense"],
    ["category", () => `categoryId=${cat.maintenance}`, (r) => r.category === "maintenance"],
    [
      "two categories",
      () => `categoryId=${cat.maintenance},${cat.utilities}`,
      (r) => ["maintenance", "utilities"].includes(r.category),
    ],
    ["from (inclusive)", () => "from=2026-07-14", (r) => r.date >= "2026-07-14"],
    ["to (exclusive)", () => "to=2026-07-14", (r) => r.date < "2026-07-14"],
    [
      "date range",
      () => "from=2026-07-01&to=2026-08-01",
      (r) => r.date >= "2026-07-01" && r.date < "2026-08-01",
    ],
    ["one booking", () => `bookingId=${lakeBooking}`, (r) => r.booking === "lake"],
    ["linked", () => "linked=true", (r) => r.booking !== undefined],
    ["unlinked", () => "linked=false", (r) => r.booking === undefined],
    [
      "property + type",
      () => `propertyId=${lake}&type=income`,
      (r) => r.property === "lake" && r.type === "income",
    ],
    [
      "property + range + type",
      () => `propertyId=${cabin}&type=expense&from=2026-07-01&to=2026-09-01`,
      (r) => r.property === "cabin" && r.type === "expense",
    ],
    [
      "category + range",
      () => `categoryId=${cat.utilities}&from=2026-07-01`,
      (r) => r.category === "utilities" && r.date >= "2026-07-01",
    ],
    [
      "type + linked",
      () => "type=expense&linked=true",
      (r) => r.type === "expense" && r.booking !== undefined,
    ],
    [
      "property + unlinked + range",
      () => `propertyId=${lake}&linked=false&to=2026-08-01`,
      (r) => r.property === "lake" && r.booking === undefined && r.date < "2026-08-01",
    ],
    ["nothing matches", () => `propertyId=${cabin}&categoryId=${cat.cleaning}`, () => false],
  ];

  for (const [name, params, match] of cases) {
    it(name, async () => {
      expect(await amounts(params())).toEqual(expected(match));
    });
  }

  it("totals every matching transaction as integers, not just the page", async () => {
    const { body } = await query(`propertyId=${lake}&pageSize=2`);
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.totals).toEqual([
      {
        currency: "EUR",
        incomeMinor: 45_000,
        expenseMinor: 3_000 + 25_000 + 7_777,
        netMinor: 45_000 - 35_777,
      },
    ]);
  });

  it("sorts by date or amount, either way, and paginates", async () => {
    const order = async (sort: string) =>
      (
        (await query(`propertyId=${lake}&sort=${sort}`)).body.items as { amountMinor: number }[]
      ).map((t) => t.amountMinor);
    expect(await order("amount")).toEqual([3_000, 5_000, 7_777, 25_000, 40_000]);
    expect(await order("-amount")).toEqual([40_000, 25_000, 7_777, 5_000, 3_000]);
    expect((await order("date"))[0]).toBe(7_777); // 30 June
    expect((await order("-date"))[0]).toBe(25_000); // 2 August

    const second = await query(`propertyId=${lake}&sort=amount&pageSize=2&page=2`);
    expect(second.body.items.map((t: { amountMinor: number }) => t.amountMinor)).toEqual([
      7_777, 25_000,
    ]);
  });

  it("sums beyond the 32-bit range exactly", async () => {
    for (let i = 0; i < 3; i++) {
      await post({
        propertyId: cabin,
        type: "income",
        categoryId: cat.booking_income,
        amountMinor: 2_000_000_000,
        date: "2026-09-01",
      });
    }
    const { body } = await query(`propertyId=${cabin}&type=income`);
    expect(body.totals[0].incomeMinor).toBe(60_000 + 6_000_000_000);
  });

  it("counts a repeated parameter like a comma-separated one", async () => {
    expect(await amounts(`categoryId=${cat.maintenance}&categoryId=${cat.utilities}`)).toEqual(
      expected((r) => ["maintenance", "utilities"].includes(r.category)),
    );
  });

  it("never returns an amount as a float", async () => {
    const response = await list(new Request(`${BASE}?pageSize=200`));
    const text = await response.text();
    for (const match of text.matchAll(
      /"(amountMinor|incomeMinor|expenseMinor|netMinor)":(-?[\d.eE+-]+)/g,
    )) {
      expect(match[2], match[0]).toMatch(/^-?\d+$/);
    }
  });

  it("rejects an invalid query", async () => {
    const { status, body } = await query("type=loss&linked=maybe&sort=size");
    expect(status).toBe(422);
    expect(Object.keys(body.error.fields).sort()).toEqual(["linked", "sort", "type"]);
    expect((await query("from=2026-08-01&to=2026-07-01")).body.error.fields.to).toEqual([
      "must be after from",
    ]);
    expect((await query(`bookingId=${lakeBooking}&linked=false`)).body.error.fields.linked).toEqual(
      ["cannot be combined with bookingId"],
    );
    expect((await query("page=9007199254740991")).status).toBe(422);
  });
});

describe("POST /api/transactions/bulk-delete", () => {
  it("deletes the given transactions, ignoring unknown ids", async () => {
    const make = async (amountMinor: number) =>
      (
        await post({
          propertyId: lake,
          type: "expense",
          categoryId: cat.cleaning,
          amountMinor,
          date: "2026-07-20",
        })
      ).body.id as string;
    const [a, b, keep] = [await make(1), await make(2), await make(3)];

    const response = await bulkDelete(
      new Request(BASE, send("POST", { ids: [a, b, "00000000-0000-4000-8000-000000000000"] })),
    );
    expect(await response.json()).toEqual({ deleted: 2 });
    expect((await db.transaction.findMany()).map((t) => t.id)).toEqual([keep]);
  });

  it("validates the ids", async () => {
    const empty = await bulkDelete(new Request(BASE, send("POST", { ids: [] })));
    expect(empty.status).toBe(422);
    const tooMany = await bulkDelete(
      new Request(
        BASE,
        send("POST", { ids: Array.from({ length: 501 }, () => crypto.randomUUID()) }),
      ),
    );
    expect((await tooMany.json()).error.fields.ids).toEqual(["at most 500 at a time"]);
  });
});
