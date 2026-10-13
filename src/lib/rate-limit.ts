/**
 * Rate limits for the endpoints worth abusing, applied by src/proxy.ts:
 * the public booking site, sign-in, the Google webhook and calendar connect
 * flow, the public iCal export feed, receipt uploads, guest erasure,
 * category reassignment and bulk deletion. A fixed window per key, in
 * memory: the app runs as one process, and a restart forgetting the counts
 * is harmless.
 *
 * Signed-in routes are limited per user. Sign-in and the webhook have no
 * user: they are limited per client address when TRUST_PROXY_HEADERS says
 * the reverse proxy's X-Forwarded-For can be believed, and otherwise per
 * route for everyone together - an unverifiable address must not decide.
 */

export type Rule = {
  name: string;
  matches: (method: string, pathname: string) => boolean;
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  by: "user" | "client";
};

const MINUTE = 60_000;
const UUID = "[0-9a-fA-F-]{36}";

export const RULES: Rule[] = [
  {
    // The public booking site's pages (GitLab #105), any method: open to
    // the internet, and each one reads the database. Generous for a person
    // browsing (page loads plus their prefetches), slow for a scraper.
    name: "public-page",
    matches: (_method, path) => path.startsWith("/stay/") || path === "/robots.txt",
    limit: 120,
    windowMs: MINUTE,
    by: "client",
  },
  {
    // Photo files of the public pages: a gallery is many at once, and they
    // are cached for a year, so a person asks for each only once.
    name: "public-photo",
    matches: (method, path) =>
      method === "GET" && /^\/api\/public\/properties\/[^/]+\/photos\/[^/]+$/.test(path),
    limit: 600,
    windowMs: MINUTE,
    by: "client",
  },
  {
    // Booking requests (GitLab #109): each one stores a guest and a booking
    // and asks the owner for an answer. Enough for a guest correcting a
    // refused request a few times; a flood is also limited per email
    // address (src/lib/booking-requests/limits.ts) and slowed by the proof
    // of work.
    name: "public-request",
    matches: (method, path) =>
      method === "POST" && /^\/api\/public\/properties\/[^/]+\/requests$/.test(path),
    limit: 10,
    windowMs: 10 * MINUTE,
    by: "client",
  },
  {
    name: "public-api",
    matches: (_method, path) => path.startsWith("/api/public/"),
    limit: 60,
    windowMs: MINUTE,
    by: "client",
  },
  {
    name: "sign-in",
    matches: (method, path) =>
      (method === "POST" && path.startsWith("/api/auth/signin")) ||
      path.startsWith("/api/auth/callback"),
    limit: 30,
    windowMs: 10 * MINUTE,
    by: "client",
  },
  {
    name: "google-webhook",
    matches: (method, path) => method === "POST" && path === "/api/google/webhook",
    limit: 300,
    windowMs: MINUTE,
    by: "client",
  },
  {
    // Public (its token is the secret): platforms fetch it every few
    // minutes to hours; guessing tokens must stay slow.
    name: "ical-export",
    matches: (method, path) => method === "GET" && path.startsWith("/api/ical/"),
    limit: 60,
    windowMs: 10 * MINUTE,
    by: "client",
  },
  {
    name: "google-connect",
    matches: (_method, path) => path === "/api/google/connect" || path === "/api/google/callback",
    limit: 20,
    windowMs: 10 * MINUTE,
    by: "user",
  },
  {
    // Each upload writes up to 10 MB to disk.
    name: "receipt-upload",
    matches: (method, path) =>
      method === "POST" && new RegExp(`^/api/transactions/${UUID}/attachments$`).test(path),
    limit: 60,
    windowMs: 10 * MINUTE,
    by: "user",
  },
  {
    // Each upload is up to 20 MB, decoded and re-encoded three times.
    name: "photo-upload",
    matches: (method, path) =>
      method === "POST" && new RegExp(`^/api/properties/${UUID}/photos$`).test(path),
    limit: 60,
    windowMs: 10 * MINUTE,
    by: "user",
  },
  {
    name: "guest-purge",
    matches: (method, path) =>
      method === "POST" && new RegExp(`^/api/guests/${UUID}/purge$`).test(path),
    limit: 10,
    windowMs: 60 * MINUTE,
    by: "user",
  },
  {
    name: "category-reassign",
    matches: (method, path) =>
      method === "POST" && new RegExp(`^/api/categories/${UUID}/reassign$`).test(path),
    limit: 30,
    windowMs: 10 * MINUTE,
    by: "user",
  },
  {
    name: "bulk-delete",
    matches: (method, path) => method === "POST" && path === "/api/transactions/bulk-delete",
    limit: 30,
    windowMs: 10 * MINUTE,
    by: "user",
  },
];

export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private now: () => number = Date.now) {}

  /** Counts one request; returns the seconds to wait when over the limit, else null. */
  hit(key: string, limit: number, windowMs: number): number | null {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.sweep(now);
    }
    window.count++;
    return window.count > limit ? Math.ceil((window.resetAt - now) / 1000) : null;
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

/**
 * The rule a request falls under and its key, or null when unlimited.
 * `user` is the signed-in user's id; `client` the trusted client address.
 */
export function rateLimitKey(
  method: string,
  pathname: string,
  { user, client }: { user: string | null; client: string | null },
): { rule: Rule; key: string } | null {
  const rule = RULES.find((r) => r.matches(method.toUpperCase(), pathname));
  if (!rule) return null;
  const who = rule.by === "user" ? (user ?? client ?? "anonymous") : (client ?? "everyone");
  return { rule, key: `${rule.name}:${who}` };
}
