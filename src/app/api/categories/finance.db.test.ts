/**
 * The finance model (GitLab #76) and the category API, against PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE, PATCH } from "@/app/api/categories/[id]/route";
import { GET as list, POST as create } from "@/app/api/categories/route";
import { DELETE as deleteProperty, PATCH as patchProperty } from "@/app/api/properties/[id]/route";
import type { Prisma } from "@/generated/prisma/client";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { systemCategory } from "@/lib/finance/categories";

let lake: string;
let cabin: string;
let lakeBooking: string;
let cabinBooking: string;

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function transaction(overrides: Partial<Prisma.TransactionUncheckedCreateInput> = {}) {
  const category = await systemCategory(
    overrides.type === "income" ? "booking_income" : "cleaning",
  );
  return db.transaction.create({
    data: {
      propertyId: lake,
      type: "expense",
      categoryId: category.id,
      amountMinor: 4_500,
      currency: "EUR",
      date: toUtcDate("2026-07-14"),
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const property = (name: string) =>
    db.property.create({ data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e" } });
  lake = (await property("Lake House")).id;
  cabin = (await property("Mountain Cabin")).id;
  const guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
  const booking = (propertyId: string) =>
    db.booking.create({
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
    });
  lakeBooking = (await booking(lake)).id;
  cabinBooking = (await booking(cabin)).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.category.deleteMany({ where: { isSystem: false } });
});

afterAll(async () => {
  await db.transaction.deleteMany();
  await db.category.deleteMany({ where: { isSystem: false } });
  await db.category.updateMany({ where: { isSystem: true }, data: { hidden: false } });
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany({ where: { id: { in: [lake, cabin] } } });
  await db.$disconnect();
});

describe("default categories", () => {
  it("exist in every database, as system categories with stable keys", async () => {
    const system = await db.category.findMany({ where: { isSystem: true } });
    expect(system.map((c) => `${c.type}:${c.systemKey}`).sort()).toEqual([
      "expense:cleaning",
      "expense:insurance",
      "expense:maintenance",
      "expense:other_expenses",
      "expense:platform_fees",
      "expense:supplies",
      "expense:taxes",
      "expense:utilities",
      "income:booking_income",
      "income:cleaning_fees",
      "income:other_income",
    ]);
  });
});

describe("transactions", () => {
  it("can exist without a linked booking", async () => {
    const row = await transaction({ description: "New towels" });
    expect(row.bookingId).toBeNull();
  });

  it("can link a booking of their own property", async () => {
    const row = await transaction({ type: "income", bookingId: lakeBooking, amountMinor: 40_000 });
    expect(row.bookingId).toBe(lakeBooking);
  });

  it("cannot link a booking of another property", async () => {
    await expect(transaction({ bookingId: cabinBooking })).rejects.toMatchObject({ code: "P2003" });
  });

  it("must use a category of their own type", async () => {
    const income = await systemCategory("booking_income");
    await expect(transaction({ type: "expense", categoryId: income.id })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("store a positive integer amount exactly", async () => {
    const row = await transaction({ amountMinor: 2_147_483_647 });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: row.id } })).amountMinor).toBe(
      2_147_483_647,
    );
    await expect(transaction({ amountMinor: 0 })).rejects.toThrow(/transactions_amount_positive/);
    await expect(transaction({ amountMinor: -5 })).rejects.toThrow(/transactions_amount_positive/);
  });

  it("are in their property's currency, which then cannot change", async () => {
    await expect(transaction({ currency: "CHF" })).rejects.toMatchObject({ code: "P2003" });

    await transaction();
    const response = await patchProperty(
      new Request(
        "http://localhost",
        send("PATCH", { currency: "CHF", defaultNightlyRateMinor: 0, defaultCleaningFeeMinor: 0 }),
      ),
      context(lake),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.currency[0]).toMatch(/transactions/);
  });

  it("are not rewritten when what they reference changes", async () => {
    await transaction({ type: "income", bookingId: lakeBooking, amountMinor: 1_000 });
    // Moving the booking would have dragged the transaction along with
    // ON UPDATE CASCADE; RESTRICT refuses instead.
    await expect(
      db.booking.update({ where: { id: lakeBooking }, data: { propertyId: cabin } }),
    ).rejects.toThrow();
  });

  it("keep their property from being deleted", async () => {
    await transaction();
    expect((await deleteProperty(new Request("http://localhost"), context(lake))).status).toBe(409);
  });
});

describe("the category API", () => {
  const api = (path = "") => `http://localhost/api/categories${path}`;

  it("lists visible categories, and hidden ones on request", async () => {
    const cleaning = await systemCategory("cleaning");
    await PATCH(new Request(api(), send("PATCH", { hidden: true })), context(cleaning.id));
    try {
      const visible = await (await list(new Request(api("?type=expense")))).json();
      expect(visible.map((c: { name: string }) => c.name)).not.toContain("Cleaning");
      const all = await (await list(new Request(api("?type=expense&includeHidden=true")))).json();
      expect(all.map((c: { name: string }) => c.name)).toContain("Cleaning");
    } finally {
      await db.category.update({ where: { id: cleaning.id }, data: { hidden: false } });
    }
  });

  it("refuses to delete a system category, which can be hidden instead", async () => {
    const taxes = await systemCategory("taxes");
    const response = await DELETE(new Request(api()), context(taxes.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.reason).toBe("system");

    const hidden = await PATCH(
      new Request(api(), send("PATCH", { hidden: true })),
      context(taxes.id),
    );
    expect((await hidden.json()).hidden).toBe(true);
    await PATCH(new Request(api(), send("PATCH", { hidden: false })), context(taxes.id));
  });

  it("refuses a system category's deletion even outside the API", async () => {
    const taxes = await systemCategory("taxes");
    await expect(db.category.delete({ where: { id: taxes.id } })).rejects.toThrow(
      /system_category/,
    );
    await expect(
      db.category.update({ where: { id: taxes.id }, data: { isSystem: false, systemKey: null } }),
    ).rejects.toThrow(/system_category/);
  });

  it("creates, renames and deletes a user category while it is unused", async () => {
    const created = await create(
      new Request(api(), send("POST", { name: "Garden", type: "expense", color: "#22C55E" })),
    );
    expect(created.status).toBe(201);
    const garden = await created.json();
    expect(garden).toMatchObject({
      isSystem: false,
      systemKey: null,
      color: "#22c55e",
      hidden: false,
    });

    const renamed = await PATCH(
      new Request(api(), send("PATCH", { name: "Garden care" })),
      context(garden.id),
    );
    expect((await renamed.json()).name).toBe("Garden care");

    expect((await DELETE(new Request(api()), context(garden.id))).status).toBe(204);
  });

  it("refuses to delete a category in use", async () => {
    const garden = await (
      await create(new Request(api(), send("POST", { name: "Garden", type: "expense" })))
    ).json();
    await transaction({ categoryId: garden.id });
    const response = await DELETE(new Request(api()), context(garden.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.reason).toBe("in_use");
  });

  it("refuses a duplicate name within a type, a type change, and invalid input", async () => {
    const duplicate = await create(
      new Request(api(), send("POST", { name: "Taxes", type: "expense" })),
    );
    expect(duplicate.status).toBe(409);
    // The same name as an income category is fine.
    expect(
      (await create(new Request(api(), send("POST", { name: "Taxes", type: "income" })))).status,
    ).toBe(201);

    const taxes = await systemCategory("taxes");
    const typeChange = await PATCH(
      new Request(api(), send("PATCH", { type: "income" })),
      context(taxes.id),
    );
    expect(typeChange.status).toBe(422);
    const bad = await create(
      new Request(api(), send("POST", { name: "", type: "loss", color: "red" })),
    );
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(["color", "name", "type"]);
  });
});
