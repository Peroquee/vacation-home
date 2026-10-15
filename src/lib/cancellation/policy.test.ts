import { describe, expect, it } from "vitest";

import { guestRefund } from "./policy";

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
