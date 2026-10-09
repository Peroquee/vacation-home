import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import {
  EXPORT_COLUMNS,
  guardFormula,
  guessMapping,
  parseAmount,
  parseDate,
  parseType,
  toCsv,
  unguard,
} from "./csv";

const row = {
  date: "2026-07-14",
  type: "expense" as const,
  amountMinor: 123450,
  currency: "EUR",
  category: "Cleaning",
  property: "Lake House",
  description: 'Window "Müller", 2 visits',
  bookingId: null,
  id: "t1",
};

describe("toCsv", () => {
  it("writes the documented columns, quoted where needed, with a BOM", () => {
    const csv = toCsv([row], "standard");
    expect(csv.startsWith("﻿")).toBe(true);
    const parsed = Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data;
    expect(parsed[0]).toEqual([...EXPORT_COLUMNS]);
    expect(parsed[1]).toEqual([
      "2026-07-14",
      "expense",
      "1234.50",
      "EUR",
      "Cleaning",
      "Lake House",
      'Window "Müller", 2 visits',
      "",
      "t1",
    ]);
  });

  it("writes semicolons and decimal commas for German Excel", () => {
    const csv = toCsv([row], "excel-de");
    expect(csv.split("\r\n")[1]).toBe(
      '2026-07-14;expense;1234,50;EUR;Cleaning;Lake House;"Window ""Müller"", 2 visits";;t1',
    );
  });

  it("keeps cells that look like formulas from running", () => {
    expect(guardFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardFormula("-5 discount")).toBe("'-5 discount");
    expect(guardFormula("Plain")).toBe("Plain");
    expect(unguard(guardFormula("=SUM(A1)"))).toBe("=SUM(A1)");
    expect(unguard("'quoted")).toBe("'quoted");
  });
});

describe("parseAmount", () => {
  it.each([
    ["1234.50", 123450],
    ["1234,50", 123450],
    ["1,234.50", 123450],
    ["1.234,50", 123450],
    ["1.234.567,89", 123456789],
    ["1.234", 123400],
    ["12,5", 1250],
    ["-12,00", -1200],
    ["12,00-", -1200],
    ["(12.00)", -1200],
    ["€ 12,00", 1200],
    ["EUR 1 234,50", 123450],
    ["+7", 700],
  ])("reads %s", (text, minor) => {
    expect(parseAmount(text, "EUR")).toBe(minor);
  });

  it("follows the currency's minor digits", () => {
    expect(parseAmount("1,500", "JPY")).toBe(1500);
    expect(parseAmount("1.234", "KWD")).toBe(1234);
  });

  it.each(["", "abc", "1,23,4", "1.2.3,45", "12.5.0", "€"])("refuses %j", (text) => {
    expect(parseAmount(text, "EUR")).toBeNull();
  });

  it("never rounds away decimals the currency does not have", () => {
    expect(parseAmount("12.3456", "EUR")).toBeNull();
    // Three digits after a lone separator group thousands, the German way.
    expect(parseAmount("12.345", "EUR")).toBe(1234500);
    expect(parseAmount("12.5", "JPY")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads ISO and German dates", () => {
    expect(parseDate("2026-07-14")).toBe("2026-07-14");
    expect(parseDate("14.07.2026")).toBe("2026-07-14");
    expect(parseDate("4.7.2026")).toBe("2026-07-04");
  });

  it("refuses ambiguous or impossible dates", () => {
    expect(parseDate("07/14/2026")).toBeNull();
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("31.04.2026")).toBeNull();
  });
});

describe("parseType and guessMapping", () => {
  it("reads English and German types", () => {
    expect(parseType("Income")).toBe("income");
    expect(parseType("Ausgabe")).toBe("expense");
    expect(parseType("refund")).toBeNull();
  });

  it("maps the app's own export, and common German headers", () => {
    expect(guessMapping([...EXPORT_COLUMNS])).toEqual({
      date: 0,
      type: 1,
      amount: 2,
      category: 4,
      property: 5,
      description: 6,
      bookingId: 7,
      id: 8,
    });
    expect(guessMapping(["Buchungstag", "Verwendungszweck", "Betrag"])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
    });
  });
});
