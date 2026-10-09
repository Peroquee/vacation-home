import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../../messages/de-DE.json";
import en from "../../messages/en-GB.json";

import { formattersFor } from "./format";

const german = createTranslator({ locale: "de-DE", messages: de });
const english = createTranslator({ locale: "en-GB", messages: en });

describe("the German catalogue", () => {
  it("pluralises and fills placeholders", () => {
    expect(german("bookings.list.count", { count: 1 })).toBe("1 Buchung");
    expect(german("bookings.list.count", { count: 3 })).toBe("3 Buchungen");
    expect(german("bookings.form.nights", { count: 2 })).toBe("2 Nächte");
    expect(english("bookings.form.nights", { count: 1 })).toBe("1 night");
  });

  it("reads German around German-formatted figures", () => {
    const format = formattersFor("de-DE");
    expect(
      german("finance.ledger.periodTotalsIn", { currency: "EUR" }) +
        ": " +
        format.money(123450, "EUR"),
    ).toBe("Summen des Zeitraums (EUR): 1.234,50 €");
    expect(
      german("conflicts.bookedBy", {
        guest: "Ada",
        when: format.dateRange("2026-07-14", "2026-07-18"),
      }),
    ).toMatch(/^Gebucht von Ada, 14\.–18\.07\.2026$/);
  });
});
