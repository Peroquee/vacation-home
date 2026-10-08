import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

import { auth, SIGN_IN_PATH } from "@/auth";
import { apiError } from "@/lib/api";
import { decideAccess } from "@/lib/access";
import { isAllowedEmail } from "@/lib/allowed-emails";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";

/**
 * Runs before every request:
 *
 * - gives it a correlation id: passed to the app as a request header (read by
 *   `requestLogger()` and the error hook in src/instrumentation.ts) and
 *   returned to the client, so a user's bug report can quote it;
 * - requires a session everywhere except the sign-in page, sending pages to
 *   sign-in and answering API calls with a 401. A session whose email has
 *   since been removed from AUTH_ALLOWED_EMAILS no longer counts.
 */
// With a lazily built configuration (see src/auth.ts), auth(handler) resolves
// to the middleware rather than returning it.
const withSession = auth((request) => {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const signedIn = isAllowedEmail(request.auth?.user?.email);

  const decision = decideAccess(request.nextUrl, signedIn);
  let response: Response;
  if (decision.kind === "unauthorized") {
    response = apiError(401, "unauthorized", "Sign in to use the API.");
  } else if (decision.kind === "sign-in") {
    const url = new URL(SIGN_IN_PATH, request.nextUrl);
    url.searchParams.set("callbackUrl", decision.callbackUrl);
    response = NextResponse.redirect(url);
  } else {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    response = NextResponse.next({ request: { headers } });
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}) as unknown as Promise<(request: NextRequest, event: NextFetchEvent) => Promise<Response>>;

// Next requires a function exported under this name.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  return (await withSession)(request, event);
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
