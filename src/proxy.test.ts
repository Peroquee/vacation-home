/**
 * src/proxy.ts, the gate in front of every request (GitLab #148). Auth.js is
 * mocked: its session middleware throws unless a test hands it a session,
 * so a public path that reached it would fail loudly. The database and the
 * list of added accounts are mocked too; nothing here needs either.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  /** What the session middleware sees; undefined: it must not run at all. */
  current: undefined as { user: { id: string; email: string } } | null | undefined,
  calls: 0,
}));

vi.mock("@/auth", () => ({
  SESSION_COOKIES: ["authjs.session-token", "__Secure-authjs.session-token"],
  SIGN_IN_PATH: "/signin",
  // auth(handler) resolves to the middleware (a lazily built configuration).
  auth: (handler: (request: unknown, event: unknown) => Promise<Response>) =>
    Promise.resolve(async (request: NextRequest, event: unknown) => {
      session.calls++;
      if (session.current === undefined) throw new Error("Auth.js must not run for this request");
      return handler(Object.assign(request, { auth: session.current }), event);
    }),
}));
vi.mock("@/lib/db", () => ({ db: { session: { deleteMany: vi.fn() } } }));
vi.mock("@/lib/allowed-emails", () => ({
  isAllowedEmail: async (email: string | null | undefined) => email === "owner@example.test",
}));

/** A fresh proxy each test: its rate limiter starts empty. */
async function proxy(url: string, init: { method?: string; cookie?: string } = {}) {
  const { proxy: run } = await import("./proxy");
  const request = new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers: init.cookie ? { cookie: init.cookie } : {},
  });
  return run(request, {} as never);
}

beforeEach(() => {
  vi.resetModules();
  session.current = undefined;
  session.calls = 0;
});

describe("the public site", () => {
  it.each(["/stay", "/stay/lake-house", "/api/public/properties/lake-house", "/robots.txt"])(
    "never asks Auth.js about %s",
    async (path) => {
      const response = await proxy(path, { cookie: "authjs.session-token=abc" });
      expect(response.status).toBe(200);
      expect(session.calls).toBe(0);
    },
  );

  it("serves the start page at the root to a visitor without a session, without Auth.js", async () => {
    const response = await proxy("/");
    expect(response.headers.get("x-middleware-rewrite")).toMatch(/\/stay$/);
    expect(session.calls).toBe(0);
  });

  it("passes the page no session cookie, only the others", async () => {
    const response = await proxy("/stay/lake-house", {
      cookie: "authjs.session-token=abc; __Secure-authjs.callback-url=x; locale=de-DE",
    });
    expect(response.headers.get("x-middleware-request-cookie")).toBe("locale=de-DE");
    // And sets none.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("answers too many requests from one client with 429 and Retry-After", async () => {
    const { proxy: run } = await import("./proxy");
    const hit = () =>
      run(new NextRequest("http://localhost:3000/api/public/properties/lake-house"), {} as never);
    // The public API allows 60 per window.
    for (let i = 0; i < 60; i++) expect((await hit()).status).toBe(200);
    const refused = await hit();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(session.calls).toBe(0);
  });
});

describe("the owner's app", () => {
  it("sends a page without a session to sign-in, back to where it was", async () => {
    session.current = null;
    const response = await proxy("/bookings?status=confirmed");
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/bookings?status=confirmed");
  });

  it("answers the API without a session with 401", async () => {
    session.current = null;
    expect((await proxy("/api/bookings")).status).toBe(401);
  });

  it("lets the owner in, with the page's security policy", async () => {
    session.current = { user: { id: "u1", email: "owner@example.test" } };
    const response = await proxy("/bookings", { cookie: "authjs.session-token=abc" });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toMatch(/nonce-/);
  });
});
