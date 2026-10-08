import { describe, expect, it } from "vitest";

import {
  bookingWindow,
  ledgerHref,
  ledgerMonth,
  ledgerParams,
  monthRange,
  runningNet,
  signedMinor,
} from "./ledger";

describe("ledger params", () => {
  it("keeps known params and drops blanks", () => {
    expect(
      ledgerParams({ month: "2026-07", type: "", other: "x", categoryId: ["a", "b"] }),
    ).toEqual({ month: "2026-07", categoryId: "a" });
  });

  it("defaults to the current month and ignores a malformed one", () => {
    expect(ledgerMonth({}, "2026-10-08")).toBe("2026-10");
    expect(ledgerMonth({ month: "2026-13" }, "2026-10-08")).toBe("2026-10");
    expect(ledgerMonth({ month: "2025-12" }, "2026-10-08")).toBe("2025-12");
  });

  it("covers a month as [first, next first)", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });

  it("builds links that change one thing", () => {
    expect(ledgerHref({ month: "2026-07", type: "expense" }, { type: undefined })).toBe(
      "/finance?month=2026-07",
    );
    expect(ledgerHref({}, {})).toBe("/finance");
  });
});

describe("amounts", () => {
  it("signs by type", () => {
    expect(signedMinor({ type: "income", amountMinor: 500 })).toBe(500);
    expect(signedMinor({ type: "expense", amountMinor: 500 })).toBe(-500);
  });

  it("runs the net per currency, in statement order", () => {
    const after = runningNet([
      { id: "a", type: "income", amountMinor: 78000, currency: "EUR" },
      { id: "b", type: "expense", amountMinor: 6000, currency: "EUR" },
      { id: "c", type: "income", amountMinor: 1500, currency: "JPY" },
      { id: "d", type: "expense", amountMinor: 2000, currency: "EUR" },
    ]);
    expect(Object.fromEntries(after)).toEqual({ a: 78000, b: 72000, c: 1500, d: 70000 });
  });

  it("looks for bookings around a date", () => {
    expect(bookingWindow("2026-07-14")).toEqual({ from: "2026-05-15", to: "2026-09-12" });
  });
});
