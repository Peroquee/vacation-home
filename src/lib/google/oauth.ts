/**
 * The OAuth side of Google Calendar access: the incremental authorisation
 * URL, the code exchange, token refresh and revocation. Everything that talks
 * to Google takes a `fetch`, so tests can stand in for Google. Never log a
 * token or a token response.
 */

/** What sign-in asks for: identity only - no calendar, no offline access. */
export const SIGN_IN_SCOPES = "openid email profile";

/** What connecting a calendar adds, on top of what was already granted. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type Fetch = typeof fetch;

export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * The URL that asks the user for calendar access. `include_granted_scopes`
 * makes it incremental; `access_type=offline` with `prompt=consent` yields a
 * refresh token every time, so reconnecting always replaces a dead one.
 */
export function connectUrl(client: OAuthClient, state: string, loginHint?: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: `openid email ${CALENDAR_SCOPE}`,
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent",
    state,
    ...(loginHint && { login_hint: loginHint }),
  }).toString();
  return url.toString();
}

/** Google said no: carries Google's error code (`invalid_grant`, ...), never a body. */
export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Google OAuth error: ${code} (HTTP ${status})`);
    this.name = "GoogleOAuthError";
  }

  /** The refresh token no longer works: revoked by the user, or expired. */
  get revoked(): boolean {
    return this.code === "invalid_grant";
  }
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

async function tokenRequest(fetchFn: Fetch, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new GoogleOAuthError(
      typeof json.error === "string" ? json.error : "unknown_error",
      response.status,
    );
  }
  return json as TokenResponse;
}

/** The identity claims of the ID token from the token endpoint (fetched over TLS from Google). */
function idTokenClaims(idToken: string | undefined): { sub: string; email?: string } {
  const payload = idToken?.split(".")[1];
  if (!payload) throw new GoogleOAuthError("missing_id_token", 200);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string;
    email?: string;
  };
  if (!claims.sub) throw new GoogleOAuthError("missing_id_token", 200);
  return { sub: claims.sub, email: claims.email };
}

export type Grant = {
  googleAccountId: string;
  googleEmail: string | null;
  scope: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
};

/** Exchanges the code from the callback for tokens and the account's identity. */
export async function exchangeCode(
  client: OAuthClient,
  code: string,
  fetchFn: Fetch = fetch,
  now = Date.now(),
): Promise<Grant> {
  const tokens = await tokenRequest(fetchFn, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: "authorization_code",
  });
  if (!tokens.refresh_token) throw new GoogleOAuthError("missing_refresh_token", 200);
  if (!tokens.scope.split(" ").includes(CALENDAR_SCOPE)) {
    throw new GoogleOAuthError("calendar_scope_not_granted", 200);
  }
  const identity = idTokenClaims(tokens.id_token);
  return {
    googleAccountId: identity.sub,
    googleEmail: identity.email ?? null,
    scope: tokens.scope,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: new Date(now + tokens.expires_in * 1000),
  };
}

export async function refreshAccessToken(
  client: Omit<OAuthClient, "redirectUri">,
  refreshToken: string,
  fetchFn: Fetch = fetch,
  now = Date.now(),
): Promise<{ accessToken: string; expiresAt: Date }> {
  const tokens = await tokenRequest(fetchFn, {
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
  });
  return { accessToken: tokens.access_token, expiresAt: new Date(now + tokens.expires_in * 1000) };
}

/** Best effort: the grant is forgotten locally whether or not Google answers. */
export async function revokeToken(token: string, fetchFn: Fetch = fetch): Promise<void> {
  try {
    await fetchFn(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Unreachable Google is not a reason to keep a connection the user removed.
  }
}
