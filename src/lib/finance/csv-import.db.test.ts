/**
 * CSV round trips against a real PostgreSQL (GitLab #83): an exported file
 * re-imports without duplicates or lost cents; a malformed row is reported
 * by line and the rest still imports; duplicates wait for confirmation.
 */
import Papa from "papaparse";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/transactions/import/route";
import { createBooking } from "@/lib/bookings/service";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { recordPayment } from "@/lib/payments/service";

import { guessMapping } from "./csv";
import { exportTransactions } from "./export";
import { type ImportRequest, importTransactions, NEGATIVE_INCOME } from "./import";

let propertyId: string;
let cleaning: { id: string; name: string };
let rent: { id: string; name: string };

const parse = (csv: string) =>
  Papa.parse<string[]>(csv.replace(/^﻿/, ""), { skipEmptyLines: true }).data;

function request(csv: string, over: Partial<ImportRequest> = {}): ImportRequest {
  const [header, ...rows] = parse(csv);
  return {
    rows,
    firstLine: 2,
    mapping: guessMapping(header!),
    defaults: {},
    commit: false,
    include: [],
    ...over,
  };
}

const count = () => db.transaction.count({ where: { propertyId } });

beforeEach(async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  propertyId = (
    await db.property.create({
      data: { name: `Lake ${tag}`, timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  cleaning = await db.category.create({
    data: { name: `Cleaning ${tag}`, type: "expense", color: "#64748b" },
  });
  rent = await db.category.create({
    data: { name: `Rent ${tag}`, type: "income", color: "#64748b" },
  });
  await db.transaction.createMany({
    data: [
      { amountMinor: 12345678, type: "income" as const, categoryId: rent.id, date: "2026-07-01" },
      {
        amountMinor: 1,
        type: "expense" as const,
        categoryId: cleaning.id,
        date: "2026-07-02",
        description: "=cmd|' /C calc'!A0",
      },
      {
        amountMinor: 4550,
        type: "expense" as const,
        categoryId: cleaning.id,
        date: "2026-07-03",
        description: 'Window "Müller", 2x',
      },
    ].map((t) => ({ ...t, propertyId, currency: "EUR", date: toUtcDate(t.date) })),
  });
});

afterAll(() => db.$disconnect());

describe("round trip", () => {
  it.each(["standard", "excel-de"] as const)(
    "re-imports a %s export as duplicates only",
    async (format) => {
      const exported = await exportTransactions({ propertyId, format, categoryId: undefined });
      if (!("csv" in exported)) throw new Error("too many");
      const preview = await importTransactions(request(exported.csv));
      expect(preview.summary).toMatchObject({ duplicate: 3, ready: 0, invalid: 0 });

      await importTransactions(request(exported.csv, { commit: true }));
      expect(await count()).toBe(3);
    },
  );

  it("brings every cent and character back", async () => {
    const exported = await exportTransactions({
      propertyId,
      format: "excel-de",
      categoryId: undefined,
    });
    if (!("csv" in exported)) throw new Error("too many");
    const before = await db.transaction.findMany({
      where: { propertyId },
      select: { amountMinor: true, type: true, description: true, categoryId: true },
      orderBy: { date: "asc" },
    });
    await db.transaction.deleteMany({ where: { propertyId } });

    const result = await importTransactions(request(exported.csv, { commit: true }));
    expect(result.summary).toMatchObject({ imported: 3 });
    const after = await db.transaction.findMany({
      where: { propertyId },
      select: { amountMinor: true, type: true, description: true, categoryId: true },
      orderBy: { date: "asc" },
    });
    expect(after).toEqual(before);
  });
});

describe("refunds (GitLab #138)", () => {
  /** A booking paid 200.00, of which 20.00 was refunded: income -20.00. */
  async function refunded() {
    const guest = await db.guest.create({ data: { name: "Ada" } });
    const result = await createBooking({
      propertyId,
      guestId: guest.id,
      checkIn: "2026-08-01",
      checkOut: "2026-08-03",
      status: "confirmed",
      source: "direct",
      guestCount: 2,
      nightlyRateMinor: 100_00,
      cleaningFeeMinor: 0,
    });
    if (!("booking" in result)) throw new Error(JSON.stringify(result));
    const pay = (kind: "full" | "refund", amountMinor: number) =>
      recordPayment(result.booking.id, {
        kind,
        method: "bank_transfer",
        amountMinor,
        receivedOn: "2026-07-10",
        note: null,
      });
    expect(await pay("full", 200_00)).toHaveProperty("payment");
    expect(await pay("refund", 20_00)).toHaveProperty("payment");
  }

  it("exports a refund as negative income", async () => {
    await refunded();
    const exported = await exportTransactions({
      propertyId,
      format: "standard",
      categoryId: undefined,
    });
    if (!("csv" in exported)) throw new Error("too many");
    expect(exported.csv).toMatch(/2026-07-10,income,-20\.00,EUR,/);
    expect(exported.csv).toMatch(/2026-07-10,income,200\.00,EUR,/);
  });

  it("never comes back from an import as positive income: the row is refused", async () => {
    await refunded();
    const exported = await exportTransactions({
      propertyId,
      format: "excel-de",
      categoryId: undefined,
    });
    if (!("csv" in exported)) throw new Error("too many");
    await db.transaction.deleteMany({ where: { propertyId } });

    const result = await importTransactions(request(exported.csv, { commit: true }));
    expect(result.summary).toMatchObject({ imported: 4, invalid: 1 });
    expect(result.rows.find((r) => r.status === "invalid")!.errors).toEqual([
      { field: "amount", message: NEGATIVE_INCOME },
    ]);
    const income = await db.transaction.findMany({
      where: { propertyId, type: "income" },
      select: { amountMinor: true },
    });
    // The 200.00 and the original 123,456.78, never a +20.00.
    expect(income.map((t) => t.amountMinor).sort((a, b) => a - b)).toEqual([200_00, 12345678]);
  });

  it("keeps reading an expense written as a negative amount, type or not", async () => {
    const csv = [
      "date,type,amount,category,description",
      `2026-07-20,expense,-5.00,${cleaning.name},Bank style`,
      `2026-07-21,,-6.00,${cleaning.name},Sign only`,
      `2026-07-22,income,-7.00,${rent.name},A refund typed in`,
    ].join("\n");
    const result = await importTransactions(
      request(csv, { defaults: { propertyId }, commit: true }),
    );
    expect(result.rows.map((r) => [r.line, r.status])).toEqual([
      [2, "imported"],
      [3, "imported"],
      [4, "invalid"],
    ]);
    const added = await db.transaction.findMany({
      where: { propertyId, date: { gte: toUtcDate("2026-07-20") } },
      orderBy: { date: "asc" },
    });
    expect(added.map((t) => [t.type, t.amountMinor])).toEqual([
      ["expense", 500],
      ["expense", 600],
    ]);
  });
});

describe("importing a spreadsheet", () => {
  const sheet = (lines: string[]) =>
    ["Datum;Betrag;Kategorie;Verwendungszweck", ...lines].join("\n");

  it("reports a malformed row by its line, and imports the rest", async () => {
    const csv = sheet([
      `14.07.2026;-12,50;${cleaning.name};Soap`,
      `31.02.2026;-5,00;${cleaning.name};Bad date`,
      `15.07.2026;abc;${cleaning.name};Bad amount`,
      `16.07.2026;-7,00;Nonexistent;Bad category`,
      `17.07.2026;900,00;${rent.name};Stay`,
    ]);
    const result = await importTransactions(
      request(csv, { defaults: { propertyId }, commit: true }),
    );
    expect(result.summary).toMatchObject({ imported: 2, invalid: 3 });
    expect(
      result.rows.filter((r) => r.status === "invalid").map((r) => [r.line, r.errors[0]!.field]),
    ).toEqual([
      [3, "date"],
      [4, "amount"],
      [5, "category"],
    ]);
    const added = await db.transaction.findMany({
      where: { propertyId, date: { gte: toUtcDate("2026-07-14") } },
      orderBy: { date: "asc" },
    });
    expect(added.map((t) => [t.type, t.amountMinor, t.description])).toEqual([
      ["expense", 1250, "Soap"],
      ["income", 90000, "Stay"],
    ]);
  });

  it("holds back duplicates, in the ledger or the file, until confirmed", async () => {
    const csv = sheet([
      `03.07.2026;-45,50;${cleaning.name};  window "MÜLLER", 2x `,
      `20.07.2026;-3,00;${cleaning.name};Coffee`,
      `20.07.2026;-3,00;${cleaning.name};Coffee`,
    ]);
    const preview = await importTransactions(request(csv, { defaults: { propertyId } }));
    expect(preview.rows.map((r) => [r.line, r.status])).toEqual([
      [2, "duplicate"],
      [3, "ready"],
      [4, "duplicate"],
    ]);
    expect(preview.rows[2]!.duplicateOf).toEqual({ line: 3 });

    const committed = await importTransactions(
      request(csv, { defaults: { propertyId }, commit: true, include: [4] }),
    );
    expect(committed.rows.map((r) => [r.line, r.status])).toEqual([
      [2, "skipped"],
      [3, "imported"],
      [4, "imported"],
    ]);
    expect(await count()).toBe(5);
  });

  it("refuses rows of an archived property", async () => {
    await db.property.update({ where: { id: propertyId }, data: { archivedAt: new Date() } });
    const result = await importTransactions(
      request(sheet([`14.07.2026;-1,00;${cleaning.name};x`]), { defaults: { propertyId } }),
    );
    expect(result.rows[0]!.errors).toEqual([{ field: "property", message: "is archived" }]);
  });
});

describe("default categories (GitLab #129)", () => {
  const csv = "date,amount,description\n2026-07-03,-12.50,Soap\n";
  const post = (body: ImportRequest) =>
    POST(
      new Request("http://localhost/api/transactions/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("refuses a default of the other type, naming its field", async () => {
    const wrong = await post(
      request(csv, { defaults: { propertyId, expenseCategoryId: rent.id } }),
    );
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).error.fields).toEqual({
      "defaults.expenseCategoryId": ["is not an expense category"],
    });
    const swapped = await post(
      request(csv, { defaults: { propertyId, incomeCategoryId: cleaning.id } }),
    );
    expect((await swapped.json()).error.fields).toEqual({
      "defaults.incomeCategoryId": ["is not an income category"],
    });
    // Nothing was imported: the three from before.
    expect(await count()).toBe(3);
  });

  it("never gives a row a default of the other type", async () => {
    const { rows } = await importTransactions(
      request(csv, { defaults: { propertyId, expenseCategoryId: rent.id } }),
    );
    expect(rows[0]).toMatchObject({
      status: "invalid",
      errors: [{ field: "category", message: "is required" }],
    });
    const right = await post(
      request(csv, { defaults: { propertyId, expenseCategoryId: cleaning.id }, commit: true }),
    );
    expect(right.status).toBe(200);
    expect(await count()).toBe(4);
  });
});
