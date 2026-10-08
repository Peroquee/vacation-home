import { describe, expect, it } from "vitest";

import { formatDate, formatDateRange, formatDateTime, formatMoney } from "@/lib/format";

// Intl output uses non-breaking and narrow no-break spaces in places; compare
// with plain spaces so the expectations stay readable.
const plain = (s: string) => s.replace(/[   ]/g, " ");

describe("formatMoney", () => {
  it("formats minor units in the currency's own precision", () => {
    expect(formatMoney(123450, "EUR", { locale: "en-US" })).toBe("€1,234.50");
    expect(formatMoney(1500, "JPY", { locale: "en-US" })).toBe("¥1,500");
    expect(plain(formatMoney(1234, "KWD", { locale: "en-US" }))).toBe("KWD 1.234");
  });

  it("follows the locale's conventions", () => {
    expect(plain(formatMoney(123450, "EUR", { locale: "de-DE" }))).toBe("1.234,50 €");
  });

  it("handles negative amounts and zero", () => {
    expect(formatMoney(-2500, "USD", { locale: "en-US" })).toBe("-$25.00");
    expect(formatMoney(0, "USD", { locale: "en-US" })).toBe("$0.00");
  });

  it("rejects fractional minor units", () => {
    expect(() => formatMoney(12.5, "USD")).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  it("formats a calendar date without shifting it by a timezone", () => {
    expect(formatDate("2026-07-14", { locale: "en-US" })).toBe("Jul 14, 2026");
    expect(formatDate("2026-01-01", { locale: "en-GB", style: "long" })).toBe("1 January 2026");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => formatDate("2026-7-14")).toThrow(RangeError);
    expect(() => formatDate("2026-02-30")).toThrow(RangeError);
  });
});

describe("formatDateRange", () => {
  it("collapses the parts both ends share", () => {
    expect(plain(formatDateRange("2026-07-14", "2026-07-18", { locale: "en-US" }))).toBe(
      "Jul 14 – 18, 2026",
    );
    expect(plain(formatDateRange("2026-12-30", "2027-01-02", { locale: "en-US" }))).toBe(
      "Dec 30, 2026 – Jan 2, 2027",
    );
  });
});

describe("formatDateTime", () => {
  it("shows an instant in the given timezone", () => {
    const instant = "2026-07-14T22:30:00Z";
    expect(plain(formatDateTime(instant, "Europe/Lisbon", { locale: "en-US" }))).toBe(
      "Jul 14, 2026, 11:30 PM",
    );
    expect(plain(formatDateTime(instant, "Asia/Tokyo", { locale: "en-US" }))).toBe(
      "Jul 15, 2026, 7:30 AM",
    );
  });

  it("rejects an invalid instant", () => {
    expect(() => formatDateTime("not a date", "UTC")).toThrow(RangeError);
  });
});
