import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

import { auth, SESSION_COOKIES, SIGN_IN_PATH } from "@/auth";
import { apiError } from "@/lib/api";
import { decideAccess, isPublicSitePath, START_PAGE_PATH } from "@/lib/access";
import { isAllowedEmail } from "@/lib/allowed-emails";
import { db } from "@/lib/db";
import { clientAddress } from "@/lib/client-address";
import { isCrossSiteMutation } from "@/lib/csrf";
import { RateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";
import {
  API_POLICY,
  commonHeaders,
  type HeaderOptions,
  newNonce,
  pagePolicy,
  publicPagePolicy,
} from "@/lib/security-headers";
import { env } from "@/env";

/**
 * Runs before every request:
 *
 * - gives it a correlation id: passed to the app as a request header (read by
 *   `requestLogger()` and the error hook in src/instrumentation.ts) and
 *   returned to the client, so a user's bug report can quote it;
 * - requires a session everywhere except the sign-in page, sending pages to
 *   sign-in and answering API calls with a 401. A session whose email has
 *   since been removed from AUTH_ALLOWED_EMAILS is revoked: its row deleted
 *   and its cookie cleared, so it cannot linger and, for instance, have a
 *   later Google sign-in on that browser attached to the old user;
 * - refuses cross-site mutating API calls (src/lib/csrf.ts) with a 403, and
 *   over-eager callers of the sensitive endpoints (src/lib/rate-limit.ts)
 *   with a 429;
 * - sets the security headers, with a fresh CSP nonce for every page
 *   (src/lib/security-headers.ts).
 *
 * The public booking site (`isPublicSitePath`) takes a separate path that
 * never involves Auth.js: no session is read, refreshed or revoked, the
 * session cookie is not even passed on to the page, and so no response
 * there can set one. Its pages get a stricter policy, and every request to
 * it is rate-limited per client.
 */
const limiter = new RateLimiter();

function headerOptions(): HeaderOptions {
  // NODE_ENV and the public DSN are build-time values, read literally.
  // eslint-disable-next-line no-restricted-properties
  const dev = process.env.NODE_ENV === "development";
  // eslint-disable-next-line no-restricted-properties
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  let reportOrigin: string | null = null;
  try {
    reportOrigin = dsn ? new URL(dsn).origin : null;
  } catch {
    reportOrigin = null;
  }
  return { https: new URL(env.APP_URL).protocol === "https:", dev, reportOrigin };
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The 403 or 429 a request gets before access is even considered, or null. */
function refusal(request: NextRequest, limited: ReturnType<typeof rateLimitKey>): Response | null {
  if (
    isCrossSiteMutation(
      { method: request.method, pathname: request.nextUrl.pathname, headers: request.headers },
      [new URL(env.APP_URL).origin, request.nextUrl.origin],
    )
  ) {
    return apiError(403, "forbidden", "Cross-site requests to the API are refused.");
  }
  const retryAfter = limited
    ? limiter.hit(limited.key, limited.rule.limit, limited.rule.windowMs)
    : null;
  if (retryAfter === null) return null;
  const response = apiError(429, "rate_limited", "Too many requests; try again later.", undefined, {
    retryAfterSeconds: retryAfter,
  });
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

/** The request id, the CSP and the common security headers, on any response. */
function withHeaders(
  response: Response,
  requestId: string,
  policy: string,
  options: HeaderOptions,
): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", policy);
  for (const [name, value] of Object.entries(commonHeaders(options))) {
    response.headers.set(name, value);
  }
  return response;
}

/** Auth.js's cookies: the session and its sign-in helpers, under any prefix. */
const AUTH_COOKIE = /^(__Secure-|__Host-)?authjs\./;

/**
 * The public booking site: never signed in, whoever asks. With `servedAs`,
 * the request is answered by that public page instead - the start page at
 * the domain's root (GitLab #117) - and limited and secured as that page.
 */
function publicSite(request: NextRequest, servedAs?: string): Response {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const pathname = servedAs ?? request.nextUrl.pathname;
  const options = headerOptions();
  const nonce = isApiPath(pathname) ? null : newNonce();
  const policy = nonce ? publicPagePolicy(nonce, options) : API_POLICY;
  const limited = rateLimitKey(request.method, pathname, {
    user: null,
    client: clientAddress(request.headers, env.TRUST_PROXY_HEADERS),
  });

  let response = refusal(request, limited);
  if (!response) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    // The page cannot see a session it is not given.
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((pair) => pair.trim())
      .filter((pair) => pair && !AUTH_COOKIE.test(pair))
      .join("; ");
    if (cookies) headers.set("cookie", cookies);
    else headers.delete("cookie");
    if (nonce) {
      headers.set("x-nonce", nonce);
      headers.set("Content-Security-Policy", policy);
    }
    response = servedAs
      ? NextResponse.rewrite(new URL(`${servedAs}${request.nextUrl.search}`, request.nextUrl), {
          request: { headers },
        })
      : NextResponse.next({ request: { headers } });
  }
  return withHeaders(response, requestId, policy, options);
}
/** Expires the session cookie, under both names it can have. */
function expireSessionCookies(response: Response) {
  for (const name of SESSION_COOKIES) {
    response.headers.append(
      "set-cookie",
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name.startsWith("__Secure-") ? "; Secure" : ""}`,
    );
  }
}

// With a lazily built configuration (see src/auth.ts), auth(handler) resolves
// to the middleware rather than returning it.
const withSession = auth(async (request) => {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const signedIn = isAllowedEmail(request.auth?.user?.email);
  const revoke = request.auth != null && !signedIn;
  if (revoke) {
    const tokens = SESSION_COOKIES.map((name) => request.cookies.get(name)?.value).filter(
      (token): token is string => Boolean(token),
    );
    await db.session.deleteMany({ where: { sessionToken: { in: tokens } } });
  }

  const decision = decideAccess(request.nextUrl, signedIn);
  if (decision.kind === "start-page") {
    const response = publicSite(request, START_PAGE_PATH);
    if (revoke) expireSessionCookies(response);
    return response;
  }

  const { pathname } = request.nextUrl;
  const options = headerOptions();
  const nonce = isApiPath(pathname) ? null : newNonce();
  const limited = rateLimitKey(request.method, pathname, {
    user: signedIn ? (request.auth?.user?.id ?? request.auth?.user?.email ?? null) : null,
    client: clientAddress(request.headers, env.TRUST_PROXY_HEADERS),
  });

  let response = refusal(request, limited);
  if (!response) {
    if (decision.kind === "unauthorized") {
      response = apiError(401, "unauthorized", "Sign in to use the API.");
    } else if (decision.kind === "sign-in") {
      const url = new URL(SIGN_IN_PATH, request.nextUrl);
      url.searchParams.set("callbackUrl", decision.callbackUrl);
      response = NextResponse.redirect(url);
    } else {
      const headers = new Headers(request.headers);
      headers.set(REQUEST_ID_HEADER, requestId);
      if (nonce) {
        // Next reads the policy from the request to put the nonce on its scripts.
        headers.set("x-nonce", nonce);
        headers.set("Content-Security-Policy", pagePolicy(nonce, options));
      }
      response = NextResponse.next({ request: { headers } });
    }
  }

  if (revoke) expireSessionCookies(response);
  return withHeaders(response, requestId, nonce ? pagePolicy(nonce, options) : API_POLICY, options);
}) as unknown as Promise<(request: NextRequest, event: NextFetchEvent) => Promise<Response>>;

// Next requires a function exported under this name.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isPublicSitePath(request.nextUrl.pathname)) return publicSite(request);
  return (await withSession)(request, event);
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
