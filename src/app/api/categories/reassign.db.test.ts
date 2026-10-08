/**
 * Moving a category's transactions (POST /api/categories/:id/reassign),
 * against PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE } from "@/app/api/categories/[id]/route";
import { POST as reassign } from "@/app/api/categories/[id]/reassign/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

let property: string;
const ids: string[] = [];

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const move = (from: string, body: unknown) =>
  reassign(
    new Request("http://test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(from),
  );

async function category(name: string, type: "income" | "expense", hidden = false) {
  const created = await db.category.create({ data: { name, type, color: "#64748b", hidden } });
  ids.push(created.id);
  return created.id;
}

async function spend(categoryId: string, amountMinor: number) {
  return db.transaction.create({
    data: {
      propertyId: property,
      type: "expense",
      categoryId,
      amountMinor,
      currency: "EUR",
      date: toUtcDate("2026-07-14"),
    },
  });
}

beforeAll(async () => {
  property = (
    await db.property.create({
      data: { name: "Reassign Lake", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { propertyId: property } });
  await db.category.deleteMany({ where: { id: { in: ids.splice(0) } } });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { propertyId: property } });
  await db.category.deleteMany({ where: { id: { in: ids } } });
  await db.property.delete({ where: { id: property } });
  await db.$disconnect();
});

describe("POST /api/categories/:id/reassign", () => {
  it("moves every transaction in one step, so the category can then be deleted", async () => {
    const pool = await category("Pool care", "expense");
    const garden = await category("Garden", "expense");
    await Promise.all([spend(pool, 1_000), spend(pool, 2_000), spend(garden, 500)]);

    const response = await move(pool, { to: garden });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ moved: 2 });
    expect(await db.transaction.count({ where: { categoryId: garden } })).toBe(3);

    const deleted = await DELETE(
      new Request("http://test/api", { method: "DELETE" }),
      context(pool),
    );
    expect(deleted.status).toBe(204);
  });

  it("moves nothing from an unused category", async () => {
    const [a, b] = [await category("A", "expense"), await category("B", "expense")];
    expect(await (await move(a, { to: b })).json()).toEqual({ moved: 0 });
  });

  it("refuses a category of the other type, on `to`", async () => {
    const pool = await category("Pool care", "expense");
    const rent = await category("Extra rent", "income");
    await spend(pool, 1_000);

    const response = await move(pool, { to: rent });
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.to).toEqual([
      "must be an expense category, like the one moved from",
    ]);
    expect(await db.transaction.count({ where: { categoryId: pool } })).toBe(1);
  });

  it("refuses the same category and a hidden one with 409", async () => {
    const pool = await category("Pool care", "expense");
    const old = await category("Old stuff", "expense", true);

    const same = await move(pool, { to: pool });
    expect(same.status).toBe(409);
    expect((await same.json()).error.fields.to).toEqual(["must be a different category"]);

    const hidden = await move(pool, { to: old });
    expect(hidden.status).toBe(409);
    expect((await hidden.json()).error.fields.to).toEqual(["is hidden"]);
  });

  it("answers 404 for an unknown category, and 422 for a malformed body", async () => {
    const pool = await category("Pool care", "expense");
    const unknown = "00000000-0000-4000-8000-000000000000";

    expect((await move(unknown, { to: pool })).status).toBe(404);
    const missingTarget = await move(pool, { to: unknown });
    expect(missingTarget.status).toBe(404);
    expect((await missingTarget.json()).error.message).toBe("Target category not found.");
    expect((await move(pool, { to: "nope" })).status).toBe(422);
    expect((await move(pool, {})).status).toBe(422);
    expect((await move("nope", { to: pool })).status).toBe(404);
  });
});
