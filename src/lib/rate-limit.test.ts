import { describe, expect, it } from "vitest";

import { RateLimiter, rateLimitKey } from "./rate-limit";

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("rateLimitKey", () => {
  it("limits the sensitive endpoints, per user or per client", () => {
    expect(
      rateLimitKey("POST", `/api/guests/${ID}/purge`, { user: "u1", client: "10.0.0.5" })?.key,
    ).toBe("guest-purge:u1");
    expect(
      rateLimitKey("POST", `/api/categories/${ID}/reassign`, { user: "u1", client: null })?.rule
        .limit,
    ).toBe(30);
    expect(
      rateLimitKey("GET", "/api/auth/callback/google", { user: null, client: "10.0.0.5" })?.key,
    ).toBe("sign-in:10.0.0.5");
    expect(rateLimitKey("POST", "/api/google/webhook", { user: null, client: null })?.key).toBe(
      "google-webhook:everyone",
    );
  });

  it("leaves everything else unlimited", () => {
    expect(rateLimitKey("GET", "/api/guests", { user: "u1", client: null })).toBeNull();
    expect(rateLimitKey("GET", `/api/guests/${ID}/purge`, { user: "u1", client: null })).toBeNull();
    expect(rateLimitKey("GET", "/api/auth/session", { user: "u1", client: null })).toBeNull();
  });
});

describe("RateLimiter", () => {
  it("allows the limit per window, then says how long to wait, then starts over", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(limiter.hit("k", 3, 60_000)).toBeNull();
    expect(limiter.hit("k", 3, 60_000)).toBe(60);
    now = 30_000;
    expect(limiter.hit("k", 3, 60_000)).toBe(30);
    expect(limiter.hit("other", 3, 60_000)).toBeNull();
    now = 60_000;
    expect(limiter.hit("k", 3, 60_000)).toBeNull();
  });
});
