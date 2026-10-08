/**
 * A user's Google Calendar connection: the grant from the incremental
 * authorisation (see ./oauth.ts), kept encrypted in `google_connections`.
 * Server-side only.
 *
 * - `getAccessToken` is the one way to call Google: it returns a valid
 *   access token, refreshing it transparently. Concurrent callers share one
 *   refresh (single-flight), so Google never sees two refreshes racing.
 * - A grant Google no longer honours - revoked in the Google account, or
 *   expired - marks the connection disconnected, which settings shows as a
 *   "reconnect" prompt; callers get a CalendarNotConnectedError rather than
 *   a silent failure.
 */
import { env } from "@/env";
import type { GoogleConnection } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decryptSecret, encryptSecret, WrongSecretKeyError } from "@/lib/secrets";

import {
  type Fetch,
  type Grant,
  GoogleOAuthError,
  type OAuthClient,
  refreshAccessToken,
  revokeToken,
} from "./oauth";

export const CALLBACK_PATH = "/api/google/callback";

/** A token this close to expiry is refreshed first, so it cannot lapse mid-request. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Why a stored connection needs reconnecting: Google no longer honours the
 * grant, or TOKEN_ENCRYPTION_KEY changed so the stored tokens are unreadable.
 */
export type DisconnectedReason = "revoked" | "key_changed";

const MESSAGES = {
  not_connected: "Google Calendar is not connected",
  revoked: "Google Calendar access was revoked; reconnect it in settings",
  key_changed: "Google Calendar tokens cannot be read after a key change; reconnect it in settings",
};

export class CalendarNotConnectedError extends Error {
  constructor(readonly reason: "not_connected" | DisconnectedReason) {
    super(MESSAGES[reason]);
    this.name = "CalendarNotConnectedError";
  }
}

/** Connecting needs somewhere safe to keep tokens. */
export function calendarConnectAvailable(): boolean {
  return env.TOKEN_ENCRYPTION_KEY !== undefined;
}

export function oauthClient(): OAuthClient {
  return {
    clientId: env.AUTH_GOOGLE_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET,
    redirectUri: new URL(CALLBACK_PATH, env.APP_URL).toString(),
  };
}

export type ConnectionStatus =
  | { status: "not_connected" }
  | {
      status: "connected" | "disconnected";
      googleEmail: string | null;
      connectedAt: Date;
      /** Set when disconnected: why it needs reconnecting. */
      reason: DisconnectedReason | null;
    };

export async function getConnectionStatus(userId: string): Promise<ConnectionStatus> {
  const row = await db.googleConnection.findUnique({ where: { userId } });
  if (!row) return { status: "not_connected" };
  return {
    status: row.status,
    googleEmail: row.googleEmail,
    connectedAt: row.connectedAt,
    reason: row.status === "disconnected" ? (row.disconnectedReason as DisconnectedReason) : null,
  };
}

/**
 * Stores a fresh grant, replacing any earlier one - reconnecting after a
 * revocation lands here too.
 */
export async function saveConnection(userId: string, grant: Grant): Promise<void> {
  const key = env.TOKEN_ENCRYPTION_KEY;
  const data = {
    googleAccountId: grant.googleAccountId,
    googleEmail: grant.googleEmail,
    scope: grant.scope,
    refreshTokenEncrypted: encryptSecret(grant.refreshToken, key),
    accessTokenEncrypted: encryptSecret(grant.accessToken, key),
    accessTokenExpiresAt: grant.expiresAt,
    status: "connected" as const,
    disconnectedReason: null,
    connectedAt: new Date(),
  };
  await db.googleConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** Refreshes in flight, by user: one per user at a time. */
const refreshes = new Map<string, Promise<string>>();

export type TokenOptions = { fetch?: Fetch; now?: () => number };

/** A valid access token for the user's calendar, refreshed if need be. */
export async function getAccessToken(userId: string, options: TokenOptions = {}): Promise<string> {
  const now = options.now ?? Date.now;
  const row = await db.googleConnection.findUnique({ where: { userId } });
  if (!row) throw new CalendarNotConnectedError("not_connected");
  if (row.status === "disconnected") {
    throw new CalendarNotConnectedError(
      (row.disconnectedReason as DisconnectedReason) ?? "revoked",
    );
  }

  if (
    row.accessTokenEncrypted &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > now()
  ) {
    return readToken(row, row.accessTokenEncrypted);
  }

  let pending = refreshes.get(userId);
  if (!pending) {
    pending = refresh(row, options.fetch ?? fetch, now()).finally(() => refreshes.delete(userId));
    refreshes.set(userId, pending);
  }
  return pending;
}

/**
 * Drops the stored access token, so the next getAccessToken refreshes: for
 * when Google rejects a token that had not yet expired (401).
 */
export async function invalidateAccessToken(userId: string): Promise<void> {
  await db.googleConnection.updateMany({
    where: { userId },
    data: { accessTokenEncrypted: null, accessTokenExpiresAt: null },
  });
}

/**
 * Marks the connection disconnected - only if it still holds the grant
 * `row` read: if the user reconnected or disconnected meanwhile, that newer
 * state wins.
 */
async function markDisconnected(row: GoogleConnection, reason: DisconnectedReason) {
  await db.googleConnection.updateMany({
    where: { userId: row.userId, refreshTokenEncrypted: row.refreshTokenEncrypted },
    data: {
      status: "disconnected",
      disconnectedReason: reason,
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
    },
  });
  logger.warn({ userId: row.userId, reason }, "google calendar connection marked disconnected");
}

/** Decrypts a stored token; one sealed under an earlier key needs a reconnect. */
async function readToken(row: GoogleConnection, sealed: string): Promise<string> {
  try {
    return decryptSecret(sealed, env.TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    if (!(error instanceof WrongSecretKeyError)) throw error;
    await markDisconnected(row, "key_changed");
    throw new CalendarNotConnectedError("key_changed");
  }
}

async function refresh(row: GoogleConnection, fetchFn: Fetch, now: number): Promise<string> {
  const key = env.TOKEN_ENCRYPTION_KEY;
  const refreshToken = await readToken(row, row.refreshTokenEncrypted);
  // Writes only apply to the grant this refresh used (see markDisconnected).
  const sameGrant = { userId: row.userId, refreshTokenEncrypted: row.refreshTokenEncrypted };
  try {
    const { accessToken, expiresAt } = await refreshAccessToken(
      oauthClient(),
      refreshToken,
      fetchFn,
      now,
    );
    await db.googleConnection.updateMany({
      where: sameGrant,
      data: {
        accessTokenEncrypted: encryptSecret(accessToken, key),
        accessTokenExpiresAt: expiresAt,
      },
    });
    return accessToken;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.revoked) {
      await markDisconnected(row, "revoked");
      throw new CalendarNotConnectedError("revoked");
    }
    throw error;
  }
}

/** Forgets the connection, revoking the grant at Google (best effort) first. */
export async function disconnect(userId: string, fetchFn: Fetch = fetch): Promise<void> {
  const row = await db.googleConnection.findUnique({ where: { userId } });
  if (!row) return;
  if (row.status === "connected") {
    // Revoking the refresh token ends the whole grant, access tokens included.
    let token: string | null = null;
    try {
      token = decryptSecret(row.refreshTokenEncrypted, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      // A key since changed or removed: nothing to revoke with. The grant
      // stays listed under the Google account's third-party access until
      // removed there; forget it here anyway.
    }
    if (token) await revokeToken(token, fetchFn);
  }
  await db.googleConnection.deleteMany({ where: { userId } });
}
