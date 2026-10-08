import { NextResponse } from "next/server";

import { env } from "@/env";
import { calendarConnectAvailable, oauthClient } from "@/lib/google/connection";
import { connectUrl } from "@/lib/google/oauth";
import { newState, stateCookie } from "@/lib/google/state";
import { getCurrentUser } from "@/lib/session";

/**
 * Starts connecting Google Calendar: a browser navigation (a link in
 * settings) that redirects to Google's consent screen, asking for calendar
 * access on top of what sign-in granted. Google returns to
 * /api/google/callback.
 */
export async function GET() {
  const user = await getCurrentUser();
  const settings = new URL("/settings", env.APP_URL);
  if (!user) return NextResponse.redirect(new URL("/signin", env.APP_URL));
  if (!calendarConnectAvailable()) {
    settings.searchParams.set("google", "unavailable");
    return NextResponse.redirect(settings);
  }

  const state = newState();
  const response = NextResponse.redirect(connectUrl(oauthClient(), state, user.email));
  response.headers.append(
    "set-cookie",
    stateCookie(user.id, state, settings.protocol === "https:"),
  );
  return response;
}
