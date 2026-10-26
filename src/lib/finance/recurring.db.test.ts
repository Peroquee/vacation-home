/**
 * Recurring expenses against a real PostgreSQL, through the routes and the
 * job's own function, with "today" fixed so periods can be walked through.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as pause } from "@/app/api/recurring-expenses/[id]/pause/route";
import { DELETE, GET as getOne, PATCH } from "@/app/api/recurring-expenses/[id]/route";
import { GET as list, POST as create } from "@/app/api/recurring-expenses/route";
import { db } from "@/lib/db";

import { materializeAll, materializeRule, resumeRecurringExpense } from "./recurring";

let propertyId: string;
let utilities: string;

const BASE = "http://localhost/api/recurring-expenses";
const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function rule(body: Record<string, unknown>) {
  const response = await create(
    new Request(
      BASE,
      json("POST", {
        propertyId,
        categoryId: utilities,
        amountMinor: 45_00,
        interval: "monthly",
        ...body,
      }),
    ),
  );
  return { status: response.status, body: await response.json() };
}
const created = async (ruleId: string) =>
  (
    await db.transaction.findMany({
      where: { recurringExpenseId: ruleId },
      orderBy: { date: "asc" },
    })
  ).map((t) => [t.date.toISOString().slice(0, 10), t.amountMinor]);

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.recurringExpense.deleteMany();
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.property.deleteMany();
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "Europe/Lisbon", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  utilities = (await db.category.findUniqueOrThrow({ where: { systemKey: "utilities" } })).id;
});

afterAll(async () => {
  await db.transaction.deleteMany();
  await db.recurringExpense.deleteMany();
  await db.$disconnect();
});

describe("a monthly rule", () => {
  it("creates exactly one transaction per period, catching up after missed runs", async () => {
    // Starts in the future, so nothing is created yet.
    const { status, body } = await rule({ startDate: "2099-01-31", description: "Internet" });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: "active",
      nextDueDate: "2099-01-31",
      amountMinor: 45_00,
      currency: "EUR",
    });
    expect(await created(body.id)).toEqual([]);

    // The job runs on the start day.
    expect(await materializeRule(body.id, "2099-01-31")).toBe(1);
    // Runs again the same day, and the next: nothing new.
    expect(await materializeRule(body.id, "2099-01-31")).toBe(0);
    expect(await materializeRule(body.id, "2099-02-27")).toBe(0);
    // No run for three months, then one: each missed period, once.
    expect(await materializeRule(body.id, "2099-05-01")).toBe(3);
    expect(await created(body.id)).toEqual([
      ["2099-01-31", 45_00],
      ["2099-02-28", 45_00],
      ["2099-03-31", 45_00],
      ["2099-04-30", 45_00],
    ]);
    const entry = await db.transaction.findFirstOrThrow({ where: { recurringExpenseId: body.id } });
    expect(entry).toMatchObject({
      type: "expense",
      isRecurring: true,
      description: "Internet",
      categoryId: utilities,
    });

    const after = await (await getOne(new Request(BASE), context(body.id))).json();
    expect(after.nextDueDate).toBe("2099-05-31");
  });

  it("is safe with two runs at once", async () => {
    const { body } = await rule({ startDate: "2099-01-01" });
    const counts = await Promise.all([
      materializeRule(body.id, "2099-12-31"),
      materializeRule(body.id, "2099-12-31"),
    ]);
    expect(counts.sort()).toEqual([0, 12]);
    expect(await created(body.id)).toHaveLength(12);
  });

  it("creates the periods already due when created with a past start date", async () => {
    // The first of the month two months back, where the property is: built
    // from the month alone, so the 29th to 31st cannot roll it over, nor the
    // last UTC hour of a month put Lisbon in the next one (GitLab #147).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(
      new Date(),
    );
    const months = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 2;
    const startDate = `${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}-01`;
    const { body } = await rule({ startDate });
    expect(await created(body.id)).toHaveLength(3);
  });

  it("stops at its end date", async () => {
    const { body } = await rule({ startDate: "2099-01-10", endDate: "2099-03-10" });
    await materializeRule(body.id, "2099-12-31");
    expect(await created(body.id)).toHaveLength(3);
    expect(await (await getOne(new Request(BASE), context(body.id))).json()).toMatchObject({
      status: "ended",
      nextDueDate: null,
    });
  });
});

describe("pausing", () => {
  it("stops creation without deleting past transactions, and skips the paused periods", async () => {
    const { body } = await rule({ startDate: "2099-01-05", interval: "quarterly" });
    await materializeRule(body.id, "2099-04-05"); // January and April
    const paused = await pause(new Request(BASE, { method: "POST" }), context(body.id));
    expect((await paused.json()).status).toBe("paused");

    expect(await materializeRule(body.id, "2099-12-31")).toBe(0);
    expect(await created(body.id)).toHaveLength(2);

    // Resumed in November: July and October are skipped; January next.
    const resumed = await resumeRecurringExpense(body.id, "2099-11-15");
    expect(resumed).toMatchObject({ pausedAt: null });
    expect(await materializeRule(body.id, "2100-01-05")).toBe(1);
    expect((await created(body.id)).map(([date]) => date)).toEqual([
      "2099-01-05",
      "2099-04-05",
      "2100-01-05",
    ]);
  });

  it("leaves the rules of an archived property alone", async () => {
    const { body } = await rule({ startDate: "2099-01-01" });
    await db.property.update({ where: { id: propertyId }, data: { archivedAt: new Date() } });
    expect(await materializeRule(body.id, "2099-06-01")).toBe(0);
    expect(await materializeAll()).toEqual({ rules: 0, created: 0 });
  });
});

describe("the API", () => {
  it("lists rules with their next due date, and filters by property", async () => {
    await rule({ startDate: "2099-01-01" });
    const all = await (await list(new Request(BASE))).json();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      nextDueDate: "2099-01-01",
      interval: "monthly",
      category: { id: utilities },
    });
    const none = await (
      await list(new Request(`${BASE}?propertyId=${crypto.randomUUID()}`))
    ).json();
    expect(none).toEqual([]);
  });

  it("changes later periods only", async () => {
    const { body } = await rule({ startDate: "2099-01-01" });
    await materializeRule(body.id, "2099-01-01");
    const response = await PATCH(
      new Request(BASE, json("PATCH", { amountMinor: 50_00 })),
      context(body.id),
    );
    expect((await response.json()).amountMinor).toBe(50_00);
    await materializeRule(body.id, "2099-02-01");
    expect(await created(body.id)).toEqual([
      ["2099-01-01", 45_00],
      ["2099-02-01", 50_00],
    ]);
  });

  it("deletes the rule but keeps its transactions", async () => {
    const { body } = await rule({ startDate: "2099-01-01" });
    await materializeRule(body.id, "2099-03-01");
    expect((await DELETE(new Request(BASE), context(body.id))).status).toBe(204);
    expect(await db.recurringExpense.count()).toBe(0);
    expect(
      await db.transaction.count({ where: { isRecurring: true, recurringExpenseId: null } }),
    ).toBe(3);
  });

  it("validates input", async () => {
    const income = await db.category.findUniqueOrThrow({ where: { systemKey: "other_income" } });
    expect(
      (await rule({ startDate: "2099-01-01", categoryId: income.id })).body.error.fields.categoryId,
    ).toEqual(["is not an expense category"]);
    expect(
      (await rule({ startDate: "2099-02-01", endDate: "2099-01-01" })).body.error.fields.endDate,
    ).toEqual(["must not be before the start date"]);
    expect(
      (await rule({ startDate: "2099-01-01", interval: "weekly", amountMinor: 0 })).status,
    ).toBe(422);
    expect(
      (await rule({ startDate: "2099-01-01", propertyId: crypto.randomUUID() })).body.error.fields
        .propertyId,
    ).toEqual(["does not exist"]);
    expect(
      (
        await PATCH(
          new Request(BASE, json("PATCH", { interval: "annual" })),
          context(crypto.randomUUID()),
        )
      ).status,
    ).toBe(422);
    expect((await getOne(new Request(BASE), context("x"))).status).toBe(404);
  });
});
