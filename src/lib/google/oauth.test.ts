import { describe, expect, it } from "vitest";

import {
  CALENDAR_SCOPE,
  connectUrl,
  exchangeCode,
  type Fetch,
  GoogleOAuthError,
  refreshAccessToken,
  SIGN_IN_SCOPES,
} from "./oauth";

const client = {
  clientId: "id.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/google/callback",
};

const idToken = (claims: object) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** A Google token endpoint that answers every request with `body`. */
function google(status: number, body: object) {
  const requests: URLSearchParams[] = [];
  const fetchFn: Fetch = async (_url, init) => {
    requests.push(new URLSearchParams(String(init?.body)));
    return Response.json(body, { status });
  };
  return { fetchFn, requests };
}

describe("scopes", () => {
  it("sign-in asks for identity only", () => {
    expect(SIGN_IN_SCOPES.split(" ")).not.toContain(CALENDAR_SCOPE);
  });

  it("connecting asks for the calendar incrementally, with offline access", () => {
    const url = new URL(connectUrl(client, "state-1", "owner@example.test"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      response_type: "code",
      include_granted_scopes: "true",
      access_type: "offline",
      prompt: "consent",
      state: "state-1",
      login_hint: "owner@example.test",
    });
    expect(url.searchParams.get("scope")?.split(" ")).toContain(CALENDAR_SCOPE);
  });
});

describe("exchangeCode", () => {
  const granted = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    scope: `openid ${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    id_token: idToken({ sub: "google-123", email: "owner@example.test" }),
  };

  it("returns the grant and the account's identity", async () => {
    const { fetchFn, requests } = google(200, granted);
    const grant = await exchangeCode(client, "code-1", fetchFn, 1_000);
    expect(grant).toEqual({
      googleAccountId: "google-123",
      googleEmail: "owner@example.test",
      scope: granted.scope,
      refreshToken: "refresh-1",
      accessToken: "access-1",
      expiresAt: new Date(1_000 + 3_600_000),
    });
    expect(Object.fromEntries(requests[0])).toMatchObject({
      code: "code-1",
      grant_type: "authorization_code",
      redirect_uri: client.redirectUri,
    });
  });

  it("refuses a grant without calendar access, or without a refresh token", async () => {
    await expect(
      exchangeCode(client, "c", google(200, { ...granted, scope: "openid email" }).fetchFn),
    ).rejects.toMatchObject({ code: "calendar_scope_not_granted" });
    await expect(
      exchangeCode(client, "c", google(200, { ...granted, refresh_token: undefined }).fetchFn),
    ).rejects.toMatchObject({ code: "missing_refresh_token" });
  });

  it("carries Google's error code, not its body", async () => {
    const error = await exchangeCode(
      client,
      "c",
      google(400, { error: "invalid_grant", error_description: "Bad Request" }).fetchFn,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect(error).toMatchObject({ code: "invalid_grant", status: 400, revoked: true });
  });
});

describe("refreshAccessToken", () => {
  it("returns the new access token and its expiry", async () => {
    const { fetchFn, requests } = google(200, {
      access_token: "access-2",
      expires_in: 100,
      scope: CALENDAR_SCOPE,
    });
    expect(await refreshAccessToken(client, "refresh-1", fetchFn, 0)).toEqual({
      accessToken: "access-2",
      expiresAt: new Date(100_000),
    });
    expect(requests[0].get("grant_type")).toBe("refresh_token");
  });

  it("reports a revoked grant", async () => {
    const error = await refreshAccessToken(
      client,
      "refresh-1",
      google(400, { error: "invalid_grant" }).fetchFn,
    ).catch((e: unknown) => e);
    expect((error as GoogleOAuthError).revoked).toBe(true);
  });

  it("does not take a server error for a revocation", async () => {
    const error = await refreshAccessToken(client, "r", google(503, {}).fetchFn).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "unknown_error", status: 503, revoked: false });
  });
});
