/**
 * The proof of work behind the public request form (GitLab #109): ALTCHA,
 * self-hosted - no third party sees the guest, unlike reCAPTCHA. Server-side
 * only.
 *
 * The form fetches a signed challenge when it opens, and the browser solves
 * it in the background (src/lib/booking-requests/solve.ts): a fraction of a
 * second for a person sending one request, real work for a bot sending
 * thousands. The challenge also carries when it was issued, so it doubles as
 * the form's start time: a request sent faster than a person can fill the
 * form is refused.
 *
 * A challenge is spent by the request it lets through, and only then: a
 * request refused for its dates gives it back, to be corrected and sent
 * again with the same one. Spent challenges are remembered in memory until they expire -
 * the app runs as one process, and the rate limits back this up.
 */
import { hkdfSync } from "node:crypto";

import {
  type Challenge,
  createChallenge,
  randomInt,
  type Solution,
  verifySolution,
} from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { z } from "zod";

import { env } from "@/env";

export const ALGORITHM = "PBKDF2/SHA-256";
/** PBKDF2 iterations per attempt, and attempts at most (on average half). */
const COST = 5_000;
const MAX_COUNTER = 400;
/** A person needs longer than this to fill the form. */
export const MIN_FILL_MS = 3_000;
/** How long a form may stay open before it needs a new challenge. */
export const CHALLENGE_LIFETIME_MS = 2 * 60 * 60_000;

/**
 * Keys of their own, derived from AUTH_SECRET (HKDF, one label each), so
 * nothing signed here is valid as anything else, nor the other way round.
 */
function key(label: string): string {
  return Buffer.from(
    hkdfSync("sha256", env.AUTH_SECRET, "", `vacation-home/booking-request/${label}`, 32),
  ).toString("hex");
}
let keys: { signature: string; keySignature: string } | null = null;
function secrets() {
  keys ??= { signature: key("altcha-signature"), keySignature: key("altcha-key-signature") };
  return keys;
}

/** A new challenge for a request to the property `slug`. */
export async function createRequestChallenge(slug: string, now = Date.now()): Promise<Challenge> {
  const { signature, keySignature } = secrets();
  return createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    // Deterministic mode: the server picks the answer and signs its key,
    // so checking a solution costs it nothing.
    counter: randomInt(MAX_COUNTER),
    deriveKey,
    expiresAt: Math.floor((now + CHALLENGE_LIFETIME_MS) / 1000),
    data: { slug, issuedAt: now },
    hmacSignatureSecret: signature,
    hmacKeySignatureSecret: keySignature,
  });
}

/** The `altcha` field of a request: a challenge and its solution, as sent. */
export const challengePayloadSchema = z.object(
  {
    challenge: z.object({
      parameters: z.looseObject({
        algorithm: z.string(),
        nonce: z.string(),
        salt: z.string(),
        cost: z.number(),
        keyLength: z.number(),
        keyPrefix: z.string(),
      }),
      signature: z.string().max(200),
    }),
    solution: z.object({
      counter: z.int().min(0),
      derivedKey: z.string().max(200),
      time: z.number().optional(),
    }),
  },
  { error: "is required" },
);
export type ChallengePayload = z.infer<typeof challengePayloadSchema>;

export type ChallengeCheck =
  | { ok: true; release: () => void }
  | { ok: false; reason: "invalid" | "expired" | "too_fast" | "spent" };

/** Spent challenges by signature, until they would have expired anyway. */
const spent = new Map<string, number>();

function forgetExpired(now: number) {
  for (const [signature, until] of spent) if (until <= now) spent.delete(signature);
}

/**
 * Whether `payload` is a solved challenge of ours for the property `slug`,
 * issued long enough ago and not yet spent - and if so, spends it at once,
 * so two requests sent together cannot both use it. `release()` gives it
 * back when the request it came with is refused.
 */
export async function checkRequestChallenge(
  payload: ChallengePayload,
  slug: string,
  now = Date.now(),
): Promise<ChallengeCheck> {
  const { signature, keySignature } = secrets();
  const challenge = payload.challenge as Challenge;
  const result = await verifySolution({
    challenge,
    solution: payload.solution as Solution,
    deriveKey,
    hmacSignatureSecret: signature,
    hmacKeySignatureSecret: keySignature,
  });
  if (result.expired) return { ok: false, reason: "expired" };
  if (!result.verified) return { ok: false, reason: "invalid" };
  // Signed with the rest, so these are ours.
  const { data, expiresAt } = challenge.parameters;
  if (data?.slug !== slug || typeof data.issuedAt !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (now - data.issuedAt < MIN_FILL_MS) return { ok: false, reason: "too_fast" };
  forgetExpired(now);
  const id = payload.challenge.signature;
  if (spent.has(id)) return { ok: false, reason: "spent" };
  spent.set(id, expiresAt ? expiresAt * 1000 : now + CHALLENGE_LIFETIME_MS);
  return { ok: true, release: () => spent.delete(id) };
}
