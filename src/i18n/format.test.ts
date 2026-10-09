import { describe, expect, it } from "vitest";

import { formattersFor } from "./format";

describe("formattersFor", () => {
  it("formats money and dates in German", () => {
    const format = formattersFor("de-DE");
    // Intl keeps the amount and the symbol together with a no-break space.
    expect(format.money(123450, "EUR")).toBe("1.234,50\u00a0€");
    expect(format.date("2026-07-14")).toBe("14.07.2026");
    expect(format.date("2026-07-14", { style: "full" })).toBe("Dienstag, 14. Juli 2026");
    expect(format.dateTime("2026-07-14T21:30:00Z", "Europe/Berlin")).toBe("14.07.2026, 23:30");
  });

  it("formats money and dates in British English, day first", () => {
    const format = formattersFor("en-GB");
    expect(format.money(123450, "EUR")).toBe("€1,234.50");
    expect(format.date("2026-07-14")).toBe("14 Jul 2026");
    expect(format.dateRange("2026-07-14", "2026-07-18")).toMatch(/^14\s–\s18 Jul 2026$/u);
  });
});
