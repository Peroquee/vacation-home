import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../../../messages/de-DE.json";
import en from "../../../messages/en-GB.json";

import { formattersFor } from "@/i18n/format";

import { describePolicy } from "./describe";
import { guestRefund, refundTimeline } from "./policy";

const SCHEDULE = { freeMonthsBefore: 6, rampMonths: 5, startPercent: 20, endPercent: 100 };

const words = (locale: "en-GB" | "de-DE") => {
  const t = createTranslator({
    locale,
    messages: locale === "en-GB" ? en : de,
    namespace: "cancellation",
  });
  const format = formattersFor(locale);
  return (policy: Parameters<typeof describePolicy>[2], checkIn?: string) =>
    describePolicy(
      (key, values) => t(key as Parameters<typeof t>[0], values),
      (date) => format.date(date, { style: "long" }),
      policy,
      "€220.00",
      checkIn,
    );
};

describe("the policy in words, wherever it is shown", () => {
  it("names the dates the cancel computation uses", () => {
    const text = words("en-GB")({ depositNonRefundable: true, schedule: SCHEDULE }, "2027-08-12");
    const timeline = refundTimeline(SCHEDULE, "2027-08-12");
    expect(text).toBe(
      "Free cancellation until 12 February 2027. After that, the share of the deposit (€220.00) kept if you cancel rises day by day from 20% to 100% until 12 July 2027; from then on, 100% of it is kept. Anything paid beyond the deposit is refunded in full.",
    );
    // The last free day is free, the next one is not.
    const terms = { depositNonRefundable: true, depositAmountMinor: 22_000, schedule: SCHEDULE };
    const on = (today: string) =>
      guestRefund(terms, 22_000, { checkIn: "2027-08-12", today }).retainedMinor;
    expect(on(timeline.freeUntil!)).toBe(0);
    expect(on(timeline.ramp!.from)).toBe(4_400);
    expect(on(timeline.ramp!.until)).toBe(22_000);
  });

  it("speaks German too", () => {
    expect(
      words("de-DE")({ depositNonRefundable: true, schedule: SCHEDULE }, "2027-08-12"),
    ).toMatch(
      /^Kostenlos stornierbar bis 12\. Februar 2027\. Danach steigt der Einbehalt .* bis 12\. Juli 2027; ab dann werden 100 % einbehalten\./,
    );
  });

  it("speaks in months while no stay is chosen", () => {
    expect(words("en-GB")({ depositNonRefundable: true, schedule: SCHEDULE })).toMatch(
      /^Free cancellation up to 6 months before arrival\. After that, .* over 5 months/,
    );
  });

  it("stays as it was without a schedule, or with the deposit refundable", () => {
    expect(words("en-GB")({ depositNonRefundable: true, schedule: null }, "2027-08-12")).toBe(
      "The deposit of €220.00 is non-refundable if you cancel. Anything paid beyond the deposit is refunded in full.",
    );
    expect(words("en-GB")({ depositNonRefundable: false, schedule: SCHEDULE }, "2027-08-12")).toBe(
      "If you cancel, everything you have paid is refunded in full.",
    );
  });
});
