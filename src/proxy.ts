import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";

/**
 * Gives every request a correlation id: passed to the app as a request header
 * (read by `requestLogger()` and the error hook in src/instrumentation.ts) and
 * returned to the client, so a user's bug report can quote it.
 */
export function proxy(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Everything except static assets, which never log.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
