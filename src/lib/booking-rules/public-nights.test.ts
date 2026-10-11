import { describe, expect, it } from "vitest";

import { addDays, daysBetween } from "@/lib/calendar-date";

import { checkOutOptions, publicNights } from "./public-nights";
import { type BookingRules, checkStay, DEFAULT_RULES } from "./rules";

const TODAY = "2026-07-01"; // a Wednesday
const rules = (overrides: Partial<BookingRules> = {}): BookingRules => ({
  ...DEFAULT_RULES,
  ...overrides,
});
/** Every night of the half-open spans. */
function nightsOf(...spans: [string, string][]): Set<string> {
  const set = new Set<string>();
  for (const [start, end] of spans) {
    for (let d = start; d < end; d = addDays(d, 1)) set.add(d);
  }
  return set;
}
const window = { from: "2026-07-01", to: "2026-08-01" };
const states = (nights: ReturnType<typeof publicNights>, from: string, to: string) =>
  nights
    .filter((n) => n.date >= from && n.date < to)
    .map((n) => `${n.date.slice(8)}:${n.available ? "free" : "taken"}${n.checkIn ? "+in" : ""}`);

describe("publicNights", () => {
  it("marks taken nights unavailable, and frees the check-out day for the next arrival", () => {
    const nights = publicNights(window, nightsOf(["2026-07-10", "2026-07-13"]), rules(), TODAY);
    expect(states(nights, "2026-07-09", "2026-07-14")).toEqual([
      "09:free+in",
      "10:taken",
      "11:taken",
      "12:taken",
      "13:free+in",
    ]);
  });

  it("keeps the buffer nights on both sides free of guests", () => {
    const nights = publicNights(
      window,
      nightsOf(["2026-07-10", "2026-07-13"]),
      rules({ bufferDays: 1 }),
      TODAY,
    );
    expect(states(nights, "2026-07-08", "2026-07-15")).toEqual([
      "08:free+in",
      "09:taken",
      "10:taken",
      "11:taken",
      "12:taken",
      "13:taken",
      "14:free+in",
    ]);
  });

  it("applies the lead time, the horizon and the check-in weekdays", () => {
    const nights = publicNights(
      window,
      new Set(),
      rules({ minLeadDays: 2, horizonDays: 10, maxNights: 3, checkInWeekdays: [6] }),
      TODAY,
    );
    // Not before the 3rd; arrivals only on Saturdays (the 4th, the 11th) up
    // to the 11th; nights reachable up to the 13th (the 11th + 3 nights - 1).
    expect(nights.filter((n) => n.checkIn).map((n) => n.date)).toEqual([
      "2026-07-04",
      "2026-07-11",
    ]);
    expect(nights.filter((n) => n.available).map((n) => n.date.slice(8))).toEqual([
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
    ]);
  });

  it("offers a check-in only where the minimum stay fits", () => {
    const nights = publicNights(
      window,
      nightsOf(["2026-07-10", "2026-07-12"]),
      rules({ minNights: 3 }),
      TODAY,
    );
    expect(states(nights, "2026-07-06", "2026-07-10")).toEqual([
      "06:free+in",
      "07:free+in",
      "08:free",
      "09:free",
    ]);
  });
});

describe("checkOutOptions", () => {
  it("runs from the minimum stay to the next taken night or the maximum", () => {
    const nights = publicNights(
      window,
      nightsOf(["2026-07-10", "2026-07-12"]),
      rules({ minNights: 2 }),
      TODAY,
    );
    expect(checkOutOptions("2026-07-05", nights, { minNights: 2, maxNights: null })).toEqual([
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);
    expect(checkOutOptions("2026-07-05", nights, { minNights: 2, maxNights: 3 })).toEqual([
      "2026-07-07",
      "2026-07-08",
    ]);
    // Not a check-in day: nothing.
    expect(checkOutOptions("2026-07-11", nights, { minNights: 2, maxNights: null })).toEqual([]);
  });
});

describe("the picker and the server agree", () => {
  // Every stay the picker offers is one the request API accepts, and every
  // stay it accepts (inside the window) is offered: one set of rules.
  it("on every stay, under assorted rules and calendars", () => {
    const from = "2026-07-01";
    const to = "2026-07-29";
    const calendars: [string, string][][] = [
      [],
      [["2026-07-08", "2026-07-11"]],
      [
        ["2026-07-05", "2026-07-07"],
        ["2026-07-14", "2026-07-15"],
        ["2026-07-20", "2026-07-26"],
      ],
    ];
    const ruleSets: Partial<BookingRules>[] = [
      {},
      { minNights: 2, bufferDays: 1 },
      { minNights: 3, maxNights: 5, minLeadDays: 3, checkInWeekdays: [5, 6] },
      { bufferDays: 2, horizonDays: 14 },
    ];
    let compared = 0;
    for (const spans of calendars) {
      const taken = nightsOf(...spans);
      const takenSpans = spans.map(([start, end]) => ({ start, end }));
      for (const overrides of ruleSets) {
        const r = rules(overrides);
        // Room after the window for the longest stay checked.
        const nights = publicNights({ from, to: addDays(to, 10) }, taken, r, TODAY);
        for (let checkIn = from; checkIn < to; checkIn = addDays(checkIn, 1)) {
          const offered = new Set(checkOutOptions(checkIn, nights, r));
          for (let length = 1; length <= 9; length++) {
            const checkOut = addDays(checkIn, length);
            const accepted =
              checkStay({ checkIn, checkOut }, r, {
                today: TODAY,
                taken: takenSpans,
                mode: "public",
              }).length === 0;
            expect({ checkIn, checkOut, rules: overrides, offered: offered.has(checkOut) }).toEqual(
              { checkIn, checkOut, rules: overrides, offered: accepted },
            );
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(3 * 4 * daysBetween(from, to) * 9);
  });
});
