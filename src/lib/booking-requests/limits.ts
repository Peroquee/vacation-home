/**
 * The per-address limit on booking requests (GitLab #109), on top of the
 * proxy's per-client one ("public-request" in src/lib/rate-limit.ts): one
 * address cannot flood the owner's inbox from many clients. In memory, like
 * the others. Server-side only.
 */
import { RateLimiter } from "@/lib/rate-limit";

export const REQUESTS_PER_EMAIL = 5;
const WINDOW_MS = 60 * 60_000;

const limiter = new RateLimiter();

/** Counts a request from `email` (normalised); the seconds to wait when over, else null. */
export function hitEmailLimit(email: string): number | null {
  return limiter.hit(`request-email:${email}`, REQUESTS_PER_EMAIL, WINDOW_MS);
}
