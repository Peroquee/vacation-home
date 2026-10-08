import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { isExclusionViolation } from "@/lib/db-errors";

/** An error shaped like the one Prisma's pg adapter raises for SQLSTATE 23P01. */
function exclusionError(message: string) {
  return new Prisma.PrismaClientKnownRequestError("Database error", {
    code: "P2039",
    clientVersion: "test",
    meta: { driverAdapterError: { cause: { originalCode: "23P01", originalMessage: message } } },
  });
}

describe("isExclusionViolation", () => {
  it("recognises the constraint whatever the server's language quotes it with", () => {
    for (const message of [
      'conflicting key value violates exclusion constraint "bookings_no_overlapping_confirmed"',
      "kollidierender Schlüsselwert verletzt Exclusion-Constraint »bookings_no_overlapping_confirmed«",
    ]) {
      expect(
        isExclusionViolation(exclusionError(message), "bookings_no_overlapping_confirmed"),
      ).toBe(true);
    }
  });

  it("does not match another constraint, a longer name, or another error", () => {
    const error = exclusionError(
      'violates exclusion constraint "bookings_no_overlapping_confirmed_v2"',
    );
    expect(isExclusionViolation(error, "bookings_no_overlapping_confirmed")).toBe(false);
    expect(isExclusionViolation(new Error("nope"), "bookings_no_overlapping_confirmed")).toBe(
      false,
    );
  });
});
