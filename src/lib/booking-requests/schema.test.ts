import { describe, expect, it } from "vitest";

import { bookingRequestSchema } from "./schema";

const valid = {
  checkIn: "2026-08-10",
  checkOut: "2026-08-14",
  guestCount: 2,
  name: " Ada Lovelace ",
  email: " Ada@Example.TEST ",
  phone: "",
  message: "",
  consent: true,
  locale: "en-GB",
  homepage: "",
  altcha: {
    challenge: {
      parameters: {
        algorithm: "PBKDF2/SHA-256",
        nonce: "n",
        salt: "s",
        cost: 1,
        keyLength: 32,
        keyPrefix: "ab",
      },
      signature: "sig",
    },
    solution: { counter: 1, derivedKey: "ab" },
  },
};

const fields = (input: unknown) => {
  const result = bookingRequestSchema.safeParse(input);
  return result.success ? null : result.error.flatten().fieldErrors;
};

describe("a booking request", () => {
  it("is normalised: trimmed, the email lower-cased, blanks as none", () => {
    const parsed = bookingRequestSchema.parse(valid);
    expect(parsed).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: null,
      message: null,
    });
  });

  it("needs the privacy consent, an email and a sensible stay", () => {
    expect(fields({ ...valid, consent: false })).toEqual({
      consent: ["must be accepted to send the request"],
    });
    expect(fields({ ...valid, consent: undefined })).toEqual({
      consent: ["must be accepted to send the request"],
    });
    expect(fields({ ...valid, email: " " })).toEqual({ email: ["is required"] });
    expect(fields({ ...valid, checkOut: "2026-08-10" })).toEqual({
      checkOut: ["must be after check-in"],
    });
    expect(fields({ ...valid, guestCount: 0 })).toEqual({ guestCount: ["must be at least 1"] });
    expect(fields({ ...valid, altcha: undefined })).toEqual({ altcha: ["is required"] });
  });

  it("takes nothing more than it asks for", () => {
    expect(bookingRequestSchema.safeParse({ ...valid, address: "Main St 1" }).success).toBe(false);
  });
});
