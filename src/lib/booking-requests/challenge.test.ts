import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ChallengePayload,
  CHALLENGE_LIFETIME_MS,
  checkRequestChallenge,
  createRequestChallenge,
  MIN_FILL_MS,
} from "./challenge";

const T0 = Date.parse("2026-07-01T12:00:00Z");

/** A challenge issued at `issuedAt` for `slug`, solved as a browser would. */
async function solved(slug = "lake-house", issuedAt = Date.now()): Promise<ChallengePayload> {
  const challenge = await createRequestChallenge(slug, issuedAt);
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("not solved");
  return {
    challenge: { parameters: challenge.parameters, signature: challenge.signature! },
    solution: { counter: solution.counter, derivedKey: solution.derivedKey },
  } as ChallengePayload;
}

// ALTCHA checks expiry against the clock itself.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("the request form's proof of work", () => {
  it("accepts a solved challenge once, and again only after it is released", async () => {
    const payload = await solved("lake-house", T0);
    const later = T0 + MIN_FILL_MS;

    const first = await checkRequestChallenge(payload, "lake-house", later);
    expect(first.ok).toBe(true);
    // Spent at once: a second request sent together is refused.
    expect(await checkRequestChallenge(payload, "lake-house", later)).toEqual({
      ok: false,
      reason: "spent",
    });
    // Given back by a refused request: the corrected one may use it.
    if (first.ok) first.release();
    expect((await checkRequestChallenge(payload, "lake-house", later)).ok).toBe(true);
  });

  it("refuses a request sent faster than a person fills the form", async () => {
    const payload = await solved("lake-house", T0);
    expect(await checkRequestChallenge(payload, "lake-house", T0 + MIN_FILL_MS - 1)).toEqual({
      ok: false,
      reason: "too_fast",
    });
  });

  it("refuses a challenge issued for another property", async () => {
    const payload = await solved("lake-house", T0);
    expect(await checkRequestChallenge(payload, "sea-view", T0 + MIN_FILL_MS)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a wrong solution and a changed challenge", async () => {
    const payload = await solved("lake-house", T0);
    const wrong = {
      ...payload,
      solution: { ...payload.solution, derivedKey: "00".repeat(32) },
    };
    expect((await checkRequestChallenge(wrong, "lake-house", T0 + MIN_FILL_MS)).ok).toBe(false);

    // Moved back in time to pass the form-time check: the signature no longer fits.
    const changed = structuredClone(payload);
    changed.challenge.parameters.data = { slug: "lake-house", issuedAt: T0 - 60_000 };
    expect(await checkRequestChallenge(changed, "lake-house", T0 + 1)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses an expired challenge", async () => {
    const payload = await solved("lake-house", T0);
    vi.setSystemTime(T0 + CHALLENGE_LIFETIME_MS + 1000);
    expect(
      await checkRequestChallenge(payload, "lake-house", T0 + CHALLENGE_LIFETIME_MS + 1000),
    ).toEqual({ ok: false, reason: "expired" });
  });
});
