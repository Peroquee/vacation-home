import { describe, expect, it } from "vitest";

import { irrelevance, type Relevance } from "./kinds";

const reserved: Relevance = {
  status: "reserved",
  reservedAt: new Date("2026-07-01T12:00:00Z"),
  depositDueOn: "2026-07-08",
  balanceDueOn: "2026-07-31",
  totalAmountMinor: 110_000,
  received: 0,
  today: "2026-07-06",
};

describe("whether an email is still worth sending", () => {
  it("asks for payment only while the booking is still reserved, by that acceptance", () => {
    expect(irrelevance("reserved", "guest", "2026-07-01T12:00:00.000Z", reserved)).toBeNull();
    expect(
      irrelevance("reserved", "guest", "2026-07-01T12:00:00.000Z", {
        ...reserved,
        status: "confirmed",
      }),
    ).toBe("no longer reserved");
    expect(irrelevance("reserved", "guest", "2026-06-01T12:00:00.000Z", reserved)).toBe(
      "reserved again since",
    );
  });

  it("reminds of a deadline only while it stands and has not passed", () => {
    expect(irrelevance("deposit_reminder", "guest", "2026-07-08", reserved)).toBeNull();
    expect(irrelevance("deposit_reminder", "guest", "2026-07-05", reserved)).toBe(
      "the deadline changed",
    );
    expect(
      irrelevance("deposit_reminder", "guest", "2026-07-08", { ...reserved, today: "2026-07-09" }),
    ).toBe("the deadline has passed");
    const owing = { ...reserved, status: "confirmed" as const, received: 22_000 };
    expect(irrelevance("balance_reminder", "guest", "2026-07-31", owing)).toBeNull();
    expect(
      irrelevance("balance_reminder", "guest", "2026-07-31", { ...owing, received: 110_000 }),
    ).toBe("no longer owing");
    expect(
      irrelevance("balance_overdue", "owner", "2026-07-31", { ...owing, status: "paid" }),
    ).toBe("no longer owing");
  });

  it("tells of an expiry only while it is expired, and the owner of a request only while open", () => {
    expect(
      irrelevance("reservation_expired", "guest", "2026-07-08", { ...reserved, status: "expired" }),
    ).toBeNull();
    expect(
      irrelevance("request_expired", "guest", "2026-07-04", { ...reserved, status: "reserved" }),
    ).toBe("no longer expired");
    expect(irrelevance("requested", "owner", "REF", { ...reserved, status: "inquiry" })).toBeNull();
    expect(irrelevance("requested", "owner", "REF", reserved)).toBe("already answered");
  });

  it("sends confirmations of what happened however late", () => {
    for (const kind of ["requested", "deposit_received", "fully_paid", "declined"] as const) {
      expect(irrelevance(kind, "guest", "x", { ...reserved, status: "cancelled" })).toBeNull();
    }
  });
});
