/**
 * The browser's half of the request form's proof of work (GitLab #109; the
 * server's is ./challenge.ts): fetch a challenge for the property and solve
 * it with the browser's own PBKDF2 (Web Crypto). Client-only; loaded with
 * the form, not with the page.
 */
import { type Challenge, solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";

export type SolvedChallenge = {
  challenge: Challenge;
  solution: { counter: number; derivedKey: string };
};

/** A solved challenge for a request to `slug`; rejects when it cannot be had. */
export async function solvedChallenge(
  slug: string,
  signal?: AbortSignal,
): Promise<SolvedChallenge> {
  const response = await fetch(`/api/public/properties/${slug}/request-challenge`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`challenge: ${response.status}`);
  const challenge: Challenge = await response.json();
  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort());
  const solution = await solveChallenge({ challenge, deriveKey, controller });
  if (!solution) throw new Error("challenge: not solved");
  return {
    // Only what the server signed goes back.
    challenge: { parameters: challenge.parameters, signature: challenge.signature },
    solution: { counter: solution.counter, derivedKey: solution.derivedKey },
  };
}
