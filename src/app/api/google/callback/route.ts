import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { calendarConnectAvailable, oauthClient, saveConnection } from "@/lib/google/connection";
import { exchangeCode, GoogleOAuthError } from "@/lib/google/oauth";
import { clearStateCookie, STATE_COOKIE, stateMatches } from "@/lib/google/state";
import { requestLogger } from "@/lib/logger";
import { getCurrentUser } from "@/lib/session";

/**
 * Where Google sends the browser back after the calendar consent screen.
 * Always ends on /settings, with `?google=` saying how it went:
 * `connected`, `denied` (the user said no), `scope_missing` (calendar
 * access unticked), `unavailable` (no TOKEN_ENCRYPTION_KEY) or `error`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const settings = new URL("/settings", env.APP_URL);
  const secure = settings.protocol === "https:";
  const finish = (outcome: string) => {
    settings.searchParams.set("google", outcome);
    const response = NextResponse.redirect(settings);
    response.headers.append("set-cookie", clearStateCookie(secure));
    return response;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/signin", env.APP_URL));
  const cookie = (await cookies()).get(STATE_COOKIE)?.value;
  if (!stateMatches(cookie, user.id, params.get("state"))) return finish("error");
  if (params.get("error"))
    return finish(params.get("error") === "access_denied" ? "denied" : "error");
  const code = params.get("code");
  if (!code) return finish("error");
  if (!calendarConnectAvailable()) return finish("unavailable");

  const log = await requestLogger();
  try {
    await saveConnection(user.id, await exchangeCode(oauthClient(), code));
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      // The code only - Google's responses carry tokens.
      log.warn({ code: error.code, status: error.status }, "google calendar connect failed");
      return finish(error.code === "calendar_scope_not_granted" ? "scope_missing" : "error");
    }
    // Google unreachable, or the database: still back to settings, not a 500.
    log.error({ err: error }, "google calendar connect failed");
    return finish("error");
  }
  log.info("google calendar connected");
  return finish("connected");
}
