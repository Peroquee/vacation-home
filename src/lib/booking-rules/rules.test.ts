import { describe, expect, it } from "vitest";

import { type BookingRules, checkStay, DEFAULT_RULES, isoWeekday, violationFields } from "./rules";
import { apiText } from "@/i18n/api-text";

import { bookingRulesSchema } from "./schema";

const TODAY = "2026-07-01"; // a Wednesday
const rules = (overrides: Partial<BookingRules>): BookingRules => ({
  ...DEFAULT_RULES,
  ...overrides,
});
const check = (
  checkIn: string,
  checkOut: string,
  overrides: Partial<BookingRules> = {},
  {
    taken = [],
    mode = "public" as const,
  }: { taken?: { start: string; end: string }[]; mode?: "public" | "owner" } = {},
) => checkStay({ checkIn, checkOut }, rules(overrides), { today: TODAY, taken, mode });
const messages = (...args: Parameters<typeof check>) =>
  check(...args).map((v) => `${v.field}: ${v.message}`);

describe("checkStay", () => {
  it("accepts any future stay under the default rules", () => {
    expect(check("2026-07-01", "2026-07-02")).toEqual([]);
    expect(check("2028-01-01", "2028-12-31")).toEqual([]);
  });

  it("enforces the minimum and maximum nights", () => {
    expect(messages("2026-07-10", "2026-07-12", { minNights: 3 })).toEqual([
      "checkOut: the stay must be at least 3 nights",
    ]);
    expect(check("2026-07-10", "2026-07-13", { minNights: 3 })).toEqual([]);
    expect(messages("2026-07-10", "2026-07-18", { maxNights: 7 })).toEqual([
      "checkOut: the stay can be at most 7 nights",
    ]);
    expect(messages("2026-07-10", "2026-07-12", { maxNights: 1 })).toEqual([
      "checkOut: the stay can be at most 1 night",
    ]);
    expect(check("2026-07-10", "2026-07-17", { maxNights: 7 })).toEqual([]);
  });

  it("enforces the lead time, counted from today", () => {
    expect(messages("2026-07-02", "2026-07-05", { minLeadDays: 2 })).toEqual([
      "checkIn: must be at least 2 days from today",
    ]);
    expect(messages("2026-07-01", "2026-07-05", { minLeadDays: 1 })).toEqual([
      "checkIn: must be at least 1 day from today",
    ]);
    expect(check("2026-07-03", "2026-07-05", { minLeadDays: 2 })).toEqual([]);
    // 0 allows arriving today.
    expect(check("2026-07-01", "2026-07-05")).toEqual([]);
  });

  it("enforces the booking horizon", () => {
    expect(messages("2027-07-02", "2027-07-05", { horizonDays: 365 })).toEqual([
      "checkIn: can be at most 365 days ahead",
    ]);
    expect(check("2027-07-01", "2027-07-05", { horizonDays: 365 })).toEqual([]);
  });

  it("refuses a stay in the past publicly, and lets the owner record one", () => {
    expect(messages("2026-06-30", "2026-07-03", { minLeadDays: 3, horizonDays: 10 })).toEqual([
      "checkIn: cannot be in the past",
    ]);
    expect(check("2026-06-01", "2026-06-03", { minLeadDays: 3 }, { mode: "owner" })).toEqual([]);
    // The owner still hears about a future stay inside the lead time.
    expect(messages("2026-07-02", "2026-07-05", { minLeadDays: 3 }, { mode: "owner" })).toEqual([
      "checkIn: must be at least 3 days from today",
    ]);
  });

  it("allows check-in only on the chosen weekdays", () => {
    expect(isoWeekday("2026-07-04")).toBe(6); // Saturday
    expect(isoWeekday("2026-07-05")).toBe(7); // Sunday
    expect(check("2026-07-04", "2026-07-11", { checkInWeekdays: [6] })).toEqual([]);
    expect(messages("2026-07-05", "2026-07-11", { checkInWeekdays: [6] })).toEqual([
      "checkIn: is not a day guests can arrive on",
    ]);
  });

  it("keeps the buffer days free next to other stays and blocks", () => {
    const taken = [
      { start: "2026-07-05", end: "2026-07-10" }, // a booking
      { start: "2026-07-20", end: "2026-07-25" }, // a block
    ];
    // Two free nights wanted on each side.
    const buffered = { bufferDays: 2 };
    expect(messages("2026-07-11", "2026-07-15", buffered, { taken })).toEqual([
      "checkIn: needs 2 free nights after the stay before",
    ]);
    expect(check("2026-07-12", "2026-07-17", buffered, { taken })).toEqual([]);
    expect(check("2026-07-12", "2026-07-18", buffered, { taken })).toEqual([]);
    expect(messages("2026-07-12", "2026-07-19", buffered, { taken })).toEqual([
      "checkOut: needs 2 free nights before the next stay",
    ]);
    // Back to back with no buffer is fine; a buffer of one is not.
    expect(check("2026-07-10", "2026-07-12", {}, { taken })).toEqual([]);
    expect(messages("2026-07-10", "2026-07-12", { bufferDays: 1 }, { taken })).toEqual([
      "checkIn: needs 1 free night after the stay before",
    ]);
  });

  it("refuses taken dates publicly without saying why, and leaves them to the owner's form", () => {
    const taken = [{ start: "2026-07-05", end: "2026-07-10" }];
    expect(check("2026-07-08", "2026-07-12", { bufferDays: 2 }, { taken })).toEqual([
      { field: "checkIn", rule: "unavailable", message: "these dates are not available" },
    ]);
    expect(check("2026-07-08", "2026-07-12", { bufferDays: 2 }, { taken, mode: "owner" })).toEqual(
      [],
    );
  });

  it("reports every broken rule, grouped by field for a 422", () => {
    const violations = check("2026-07-02", "2026-07-03", {
      minNights: 2,
      minLeadDays: 7,
      checkInWeekdays: [6],
    });
    expect(violationFields(violations)).toEqual({
      checkIn: ["must be at least 7 days from today", "is not a day guests can arrive on"],
      checkOut: ["the stay must be at least 2 nights"],
    });
  });
});

describe("the rule messages", () => {
  it("are all phrases of the message catalogue, so the clients translate them", () => {
    const taken = [
      { start: "2026-07-05", end: "2026-07-10" },
      { start: "2026-07-20", end: "2026-07-25" },
    ];
    const all = [1, 2].flatMap((n) => [
      ...check("2026-06-30", "2026-07-02"),
      ...check("2026-07-06", "2026-07-08", {}, { taken }),
      ...check("2026-07-01", "2026-07-02", { minLeadDays: n, checkInWeekdays: [7], minNights: 2 }),
      ...check("2026-07-04", "2026-07-08", { horizonDays: n, maxNights: n }),
      ...check("2026-07-11", "2026-07-19", { bufferDays: n }, { taken }),
    ]);
    expect(new Set(all.map((v) => v.rule)).size).toBe(8);
    for (const { message } of all) {
      expect(
        apiText(message, (key) => `key:${key}`),
        message,
      ).toMatch(/^key:/);
    }
  });
});

describe("bookingRulesSchema", () => {
  const valid = {
    minNights: 2,
    maxNights: 14,
    minLeadDays: 1,
    horizonDays: 365,
    checkInWeekdays: [6, 3],
    bufferDays: 1,
  };

  it("accepts sensible rules and sorts the weekdays", () => {
    expect(bookingRulesSchema.parse(valid).checkInWeekdays).toEqual([3, 6]);
    expect(
      bookingRulesSchema.safeParse({ ...valid, maxNights: null, horizonDays: null }).success,
    ).toBe(true);
  });

  it("refuses rules that contradict each other or are out of range", () => {
    const issues = (input: object) =>
      bookingRulesSchema
        .safeParse({ ...valid, ...input })
        .error?.issues.map((i) => i.path.join("."));
    expect(issues({ maxNights: 1 })).toEqual(["maxNights"]);
    expect(issues({ horizonDays: 1 })).toEqual(["horizonDays"]);
    expect(issues({ minNights: 0 })).toEqual(["minNights"]);
    expect(issues({ bufferDays: 31 })).toEqual(["bufferDays"]);
    expect(issues({ checkInWeekdays: [0] })).toEqual(["checkInWeekdays.0"]);
    expect(issues({ checkInWeekdays: [6, 6] })).toEqual(["checkInWeekdays"]);
  });
});
