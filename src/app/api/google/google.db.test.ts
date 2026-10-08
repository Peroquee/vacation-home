import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { CALENDAR_SCOPE } from "@/lib/google/oauth";
import { STATE_COOKIE } from "@/lib/google/state";

const session = vi.hoisted(() => ({ userId: "", cookie: undefined as string | undefined }));

vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: session.userId,
    name: "Owner",
    email: "owner@example.test",
    image: null,
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === STATE_COOKIE && session.cookie ? { value: session.cookie } : undefined,
  }),
}));

import { GET as callback } from "@/app/api/google/callback/route";
import { GET as connect } from "@/app/api/google/connect/route";
import { DELETE, GET as status } from "@/app/api/google/connection/route";

const idToken = `h.${Buffer.from(JSON.stringify({ sub: "google-123", email: "cal@example.test" })).toString("base64url")}.s`;
const google = vi.fn<typeof fetch>();

/** Starts the flow, keeping the cookie as the browser would; returns the state sent to Google. */
async function start(): Promise<string> {
  const response = await connect();
  const location = new URL(response.headers.get("location")!);
  session.cookie = response.headers.get("set-cookie")!.split(";")[0].split("=").slice(1).join("=");
  return location.searchParams.get("state")!;
}

const back = (params: Record<string, string>) =>
  callback(new Request(`http://localhost:3000/api/google/callback?${new URLSearchParams(params)}`));
const outcome = (response: Response) =>
  new URL(response.headers.get("location")!).searchParams.get("google");

beforeEach(async () => {
  await db.googleConnection.deleteMany();
  await db.user.deleteMany({ where: { email: "owner@example.test" } });
  session.userId = (await db.user.create({ data: { email: "owner@example.test" } })).id;
  session.cookie = undefined;
  google.mockReset();
  google.mockResolvedValue(
    Response.json({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: `openid ${CALENDAR_SCOPE}`,
      id_token: idToken,
    }),
  );
  vi.stubGlobal("fetch", google);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

describe("connecting Google Calendar", () => {
  it("connects through Google's consent screen", async () => {
    const response = await connect();
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/google/callback",
    );

    const state = await start();
    const done = await back({ code: "code-1", state });
    expect(done.headers.get("location")).toBe("http://localhost:3000/settings?google=connected");
    expect(done.headers.get("set-cookie")).toContain("Max-Age=0");

    const body = await (await status()).json();
    expect(body).toMatchObject({
      available: true,
      status: "connected",
      googleEmail: "cal@example.test",
    });
  });

  it("refuses a callback without the state this browser was given", async () => {
    await start();
    expect(outcome(await back({ code: "code-1", state: "forged" }))).toBe("error");
    session.cookie = undefined;
    expect(outcome(await back({ code: "code-1", state: "forged" }))).toBe("error");
    expect(google).not.toHaveBeenCalled();
    expect(await db.googleConnection.count()).toBe(0);
  });

  it("reports a refusal, and a grant without calendar access", async () => {
    expect(outcome(await back({ error: "access_denied", state: await start() }))).toBe("denied");

    google.mockResolvedValue(
      Response.json({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        scope: "openid email",
        id_token: idToken,
      }),
    );
    expect(outcome(await back({ code: "c", state: await start() }))).toBe("scope_missing");
    expect(await db.googleConnection.count()).toBe(0);
  });

  it("returns to settings when Google cannot be reached", async () => {
    const state = await start();
    google.mockRejectedValue(new TypeError("fetch failed"));
    expect(outcome(await back({ code: "c", state }))).toBe("error");
  });

  it("disconnects", async () => {
    await back({ code: "code-1", state: await start() });
    google.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await DELETE()).status).toBe(204);
    expect(google).toHaveBeenLastCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.anything(),
    );
    expect(await (await status()).json()).toEqual({ available: true, status: "not_connected" });
  });
});
