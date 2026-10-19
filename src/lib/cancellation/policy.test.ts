import { describe, expect, it } from "vitest";

import { guestRefund, keptPercentOn, monthsBefore, refundTimeline } from "./policy";

const KEPT = { depositNonRefundable: true, depositAmountMinor: 22_000 };
const REFUNDABLE = { ...KEPT, depositNonRefundable: false };

describe("a guest's refund when they cancel", () => {
  it("keeps a non-refundable deposit and refunds everything beyond it", () => {
    expect(guestRefund(KEPT, 22_000)).toEqual({
      receivedMinor: 22_000,
      retainedMinor: 22_000,
      refundMinor: 0,
    });
    expect(guestRefund(KEPT, 110_000)).toMatchObject({
      retainedMinor: 22_000,
      refundMinor: 88_000,
    });
    expect(guestRefund(KEPT, 30_000).refundMinor).toBe(8_000);
  });

  it("keeps no more than was paid when less than the deposit came in", () => {
    expect(guestRefund(KEPT, 10_000)).toMatchObject({ retainedMinor: 10_000, refundMinor: 0 });
    expect(guestRefund(KEPT, 0)).toEqual({ receivedMinor: 0, retainedMinor: 0, refundMinor: 0 });
  });

  it("refunds everything when the deposit is refundable", () => {
    expect(guestRefund(REFUNDABLE, 22_000)).toMatchObject({
      retainedMinor: 0,
      refundMinor: 22_000,
    });
    expect(guestRefund(REFUNDABLE, 110_000).refundMinor).toBe(110_000);
    expect(guestRefund(REFUNDABLE, 0).refundMinor).toBe(0);
  });

  it("never refunds less than nothing nor more than was paid", () => {
    expect(guestRefund(KEPT, -5_000)).toEqual({
      receivedMinor: 0,
      retainedMinor: 0,
      refundMinor: 0,
    });
    expect(guestRefund({ ...KEPT, depositAmountMinor: -1 }, 5_000).refundMinor).toBe(5_000);
  });
});

describe("the refund schedule (GitLab #123)", () => {
  // The spec's example: free until 6 months before arrival, then 20% -> 100%
  // of the deposit over 5 months, so all of it from 1 month before arrival.
  const SCHEDULE = { freeMonthsBefore: 6, rampMonths: 5, startPercent: 20, endPercent: 100 };
  const TERMS = { depositNonRefundable: true, depositAmountMinor: 100_000, schedule: SCHEDULE };
  const CHECK_IN = "2027-08-12";
  const kept = (today: string, received = 100_000) =>
    guestRefund(TERMS, received, { checkIn: CHECK_IN, today }).retainedMinor;

  it("dates the schedule from the arrival", () => {
    expect(refundTimeline(SCHEDULE, CHECK_IN)).toEqual({
      freeUntil: "2027-02-12",
      ramp: { from: "2027-02-13", until: "2027-07-12" },
      startPercent: 20,
      endPercent: 100,
    });
  });

  it("keeps nothing inside the free window, its last day included", () => {
    expect(kept("2026-11-01")).toBe(0);
    expect(kept("2027-02-12")).toBe(0);
  });

  it("starts the ramp at the start share on its first day", () => {
    expect(kept("2027-02-13")).toBe(20_000);
  });

  it("rises day by day, linearly, to the end share on the ramp's last day", () => {
    // 149 days from 13 Feb to 12 Jul; 13 Feb + 74.5 days is the middle.
    expect(kept("2027-04-28")).toBe(Math.round((100_000 * (20 * 149 + 80 * 74)) / (100 * 149)));
    expect(kept("2027-04-29")).toBe(Math.round((100_000 * (20 * 149 + 80 * 75)) / (100 * 149)));
    expect(kept("2027-07-12")).toBe(100_000);
  });

  it("keeps the end share after the ramp, up to arrival and beyond", () => {
    expect(kept("2027-07-13")).toBe(100_000);
    expect(kept("2027-08-12")).toBe(100_000);
    expect(kept("2027-08-20")).toBe(100_000);
  });

  it("never keeps more than was paid; the rest is refunded", () => {
    expect(guestRefund(TERMS, 30_000, { checkIn: CHECK_IN, today: "2027-07-20" })).toEqual({
      receivedMinor: 30_000,
      retainedMinor: 30_000,
      refundMinor: 0,
    });
    // Paid in full (deposit and balance), inside the window: all of it back.
    expect(
      guestRefund(TERMS, 500_000, { checkIn: CHECK_IN, today: "2027-01-01" }).refundMinor,
    ).toBe(500_000);
  });

  it("applies the same to a stay booked inside the ramp, or at short notice", () => {
    // Booked in May for August: cancelling at once already keeps part of it.
    expect(kept("2027-05-02")).toBeGreaterThan(20_000);
    // Booked a week before arrival: past the ramp, all of it is kept.
    expect(kept("2027-08-05")).toBe(100_000);
  });

  it("counts months back to the month's last day where the day is missing", () => {
    expect(monthsBefore("2027-03-31", 1)).toBe("2027-02-28");
    expect(monthsBefore("2028-03-31", 1)).toBe("2028-02-29");
    expect(monthsBefore("2027-01-15", 2)).toBe("2026-11-15");
    expect(monthsBefore("2027-08-31", 6)).toBe("2027-02-28");
    expect(refundTimeline(SCHEDULE, "2027-08-31")).toMatchObject({
      freeUntil: "2027-02-28",
      ramp: { from: "2027-03-01", until: "2027-07-31" },
    });
  });

  it("without a schedule keeps all of the deposit, as #116 did", () => {
    const plain = { depositNonRefundable: true, depositAmountMinor: 22_000 };
    expect(guestRefund(plain, 110_000, { checkIn: CHECK_IN, today: "2026-01-01" })).toEqual({
      receivedMinor: 110_000,
      retainedMinor: 22_000,
      refundMinor: 88_000,
    });
  });

  it("with no free window and no ramp keeps a fixed share", () => {
    const fixed = {
      ...TERMS,
      schedule: { freeMonthsBefore: null, rampMonths: 0, startPercent: 50, endPercent: 50 },
    };
    expect(
      guestRefund(fixed, 100_000, { checkIn: CHECK_IN, today: "2026-01-01" }).retainedMinor,
    ).toBe(50_000);
  });

  it("with a free window and no ramp jumps to the end share the day after", () => {
    const step = { ...TERMS, schedule: { ...SCHEDULE, rampMonths: 0 } };
    expect(
      guestRefund(step, 100_000, { checkIn: CHECK_IN, today: "2027-02-12" }).retainedMinor,
    ).toBe(0);
    expect(
      guestRefund(step, 100_000, { checkIn: CHECK_IN, today: "2027-02-13" }).retainedMinor,
    ).toBe(100_000);
  });

  it("keeps nothing when the deposit is refundable, whatever the schedule", () => {
    const refundable = { ...TERMS, depositNonRefundable: false };
    expect(
      guestRefund(refundable, 100_000, { checkIn: CHECK_IN, today: "2027-08-01" }).retainedMinor,
    ).toBe(0);
    expect(keptPercentOn(refundable, CHECK_IN, "2027-08-01")).toBe(0);
  });

  it("states the share kept on a day, for the dialog", () => {
    expect(keptPercentOn(TERMS, CHECK_IN, "2027-02-12")).toBe(0);
    expect(keptPercentOn(TERMS, CHECK_IN, "2027-02-13")).toBe(20);
    expect(keptPercentOn(TERMS, CHECK_IN, "2027-07-12")).toBe(100);
  });
});
