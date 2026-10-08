import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";

import {
  CalendarNotConnectedError,
  disconnect,
  getAccessToken,
  getConnectionStatus,
  saveConnection,
} from "./connection";
import { CALENDAR_SCOPE, type Fetch } from "./oauth";

let userId: string;
const NOW = Date.UTC(2026, 9, 8, 12);

const grant = (refreshToken = "refresh-1", expiresAt = new Date(NOW - 1)) => ({
  googleAccountId: "google-123",
  googleEmail: "owner@example.test",
  scope: `openid ${CALENDAR_SCOPE}`,
  refreshToken,
  accessToken: "access-old",
  expiresAt,
});

/** A Google that answers each call through `answer`, counting them. */
function google(answer: (body: URLSearchParams, url: string) => Response | Promise<Response>) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const body = new URLSearchParams(String(init?.body));
    calls.push({ url: String(url), body });
    return answer(body, String(url));
  };
  return { fetchFn, calls };
}

const tokens = (accessToken: string) => () =>
  Response.json({ access_token: accessToken, expires_in: 3600, scope: CALENDAR_SCOPE });

beforeEach(async () => {
  await db.googleConnection.deleteMany();
  await db.user.deleteMany({ where: { email: "gcal@example.test" } });
  userId = (await db.user.create({ data: { email: "gcal@example.test" } })).id;
});

afterAll(() => db.$disconnect());

describe("storage", () => {
  it("keeps tokens encrypted", async () => {
    await saveConnection(userId, grant());
    const row = await db.googleConnection.findUniqueOrThrow({ where: { userId } });
    expect(row.refreshTokenEncrypted).toMatch(/^v1:/);
    expect(row.refreshTokenEncrypted).not.toContain("refresh-1");
    expect(row.accessTokenEncrypted).not.toContain("access-old");
    expect(await getConnectionStatus(userId)).toMatchObject({
      status: "connected",
      googleEmail: "owner@example.test",
      reason: null,
    });
  });

  it("reports a user who never connected", async () => {
    expect(await getConnectionStatus(userId)).toEqual({ status: "not_connected" });
    await expect(getAccessToken(userId)).rejects.toMatchObject({ reason: "not_connected" });
  });
});

describe("getAccessToken", () => {
  it("returns a still-valid token without calling Google", async () => {
    await saveConnection(userId, grant("refresh-1", new Date(NOW + 30 * 60_000)));
    const { fetchFn, calls } = google(tokens("unused"));
    expect(await getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).toBe("access-old");
    expect(calls).toHaveLength(0);
  });

  it("refreshes an expired token, and stores the new one", async () => {
    await saveConnection(userId, grant());
    const { fetchFn, calls } = google(tokens("access-new"));
    expect(await getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).toBe("access-new");
    expect(calls[0].body.get("refresh_token")).toBe("refresh-1");
    // Now cached: no second refresh.
    expect(await getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).toBe("access-new");
    expect(calls).toHaveLength(1);
  });

  it("refreshes a token about to expire", async () => {
    await saveConnection(userId, grant("refresh-1", new Date(NOW + 10_000)));
    const { fetchFn, calls } = google(tokens("access-new"));
    expect(await getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).toBe("access-new");
    expect(calls).toHaveLength(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    await saveConnection(userId, grant());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fetchFn, calls } = google(async () => {
      await gate;
      return tokens("access-new")();
    });
    const callers = Array.from({ length: 5 }, () =>
      getAccessToken(userId, { fetch: fetchFn, now: () => NOW }),
    );
    // Let every caller reach the refresh before Google answers.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    expect(await Promise.all(callers)).toEqual(Array(5).fill("access-new"));
    expect(calls).toHaveLength(1);
  });

  it("marks a revoked grant disconnected, so settings can prompt a reconnect", async () => {
    await saveConnection(userId, grant());
    const revoked = google(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const error = await getAccessToken(userId, { fetch: revoked.fetchFn, now: () => NOW }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CalendarNotConnectedError);
    expect(error).toMatchObject({ reason: "revoked" });
    expect(await getConnectionStatus(userId)).toMatchObject({
      status: "disconnected",
      reason: "revoked",
    });

    // Later calls fail fast, without asking Google again.
    await expect(getAccessToken(userId, { fetch: revoked.fetchFn })).rejects.toMatchObject({
      reason: "revoked",
    });
    expect(revoked.calls).toHaveLength(1);

    // Reconnecting restores it.
    await saveConnection(userId, grant("refresh-2"));
    expect(await getConnectionStatus(userId)).toMatchObject({ status: "connected", reason: null });
    const { fetchFn, calls } = google(tokens("access-3"));
    expect(await getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).toBe("access-3");
    expect(calls[0].body.get("refresh_token")).toBe("refresh-2");
  });

  it("asks for a reconnect when the tokens were sealed under an earlier key", async () => {
    await saveConnection(userId, grant("refresh-1", new Date(NOW + 3_600_000)));
    const earlierKey = randomBytes(32).toString("base64");
    await db.googleConnection.update({
      where: { userId },
      data: {
        refreshTokenEncrypted: encryptSecret("refresh-1", earlierKey),
        accessTokenEncrypted: encryptSecret("access-old", earlierKey),
      },
    });
    const { fetchFn, calls } = google(tokens("unused"));
    await expect(getAccessToken(userId, { fetch: fetchFn, now: () => NOW })).rejects.toMatchObject({
      reason: "key_changed",
    });
    expect(calls).toHaveLength(0);
    expect(await getConnectionStatus(userId)).toMatchObject({
      status: "disconnected",
      reason: "key_changed",
    });
  });

  it("leaves the connection alone when Google is merely unavailable", async () => {
    await saveConnection(userId, grant());
    const down = google(() => Response.json({}, { status: 503 }));
    await expect(getAccessToken(userId, { fetch: down.fetchFn, now: () => NOW })).rejects.toThrow(
      /HTTP 503/,
    );
    expect(await getConnectionStatus(userId)).toMatchObject({ status: "connected" });
  });

  it("does not let a refresh overwrite a reconnect that happened meanwhile", async () => {
    await saveConnection(userId, grant());
    const revoked = google(async () => {
      await saveConnection(userId, grant("refresh-2", new Date(NOW + 3_600_000)));
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });
    await expect(
      getAccessToken(userId, { fetch: revoked.fetchFn, now: () => NOW }),
    ).rejects.toBeInstanceOf(CalendarNotConnectedError);
    expect(await getConnectionStatus(userId)).toMatchObject({ status: "connected" });
  });
});

describe("disconnect", () => {
  it("revokes the grant at Google and forgets it", async () => {
    await saveConnection(userId, grant());
    const { fetchFn, calls } = google(() => new Response(null, { status: 200 }));
    await disconnect(userId, fetchFn);
    expect(calls).toEqual([
      {
        url: "https://oauth2.googleapis.com/revoke",
        body: new URLSearchParams({ token: "refresh-1" }),
      },
    ]);
    expect(await getConnectionStatus(userId)).toEqual({ status: "not_connected" });
  });

  it("forgets it even when Google cannot be reached", async () => {
    await saveConnection(userId, grant());
    await disconnect(userId, async () => {
      throw new TypeError("fetch failed");
    });
    expect(await getConnectionStatus(userId)).toEqual({ status: "not_connected" });
  });

  it("goes with the user", async () => {
    await saveConnection(userId, grant());
    await db.user.delete({ where: { id: userId } });
    expect(await db.googleConnection.count()).toBe(0);
  });
});
