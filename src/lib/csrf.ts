/**
 * Cross-site request forgery protection for the JSON API, applied by
 * src/proxy.ts. Pure, so the rule is testable.
 *
 * Two layers. The session cookie is SameSite=Lax, so browsers do not send it
 * with another site's POST/PATCH/DELETE. On top of that, a mutating API call
 * from a browser must come from this app's own origin: browsers mark every
 * request with `Sec-Fetch-Site` and, for these methods, `Origin`, which a
 * page cannot forge. Requests without either header do not come from a
 * browser page, and CSRF is an attack through a browser, so they pass (the
 * session still decides what they may do).
 *
 * Exempt: Auth.js's own routes, which carry its CSRF token, and Google's push
 * notifications, which carry their channel secret and no session.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT = (pathname: string) =>
  pathname === "/api/auth" ||
  pathname.startsWith("/api/auth/") ||
  pathname === "/api/google/webhook";

export function isCrossSiteMutation(
  request: { method: string; pathname: string; headers: Headers },
  /** The app's origins: APP_URL's, and the one the request was addressed to. */
  ownOrigins: string[],
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (!(request.pathname === "/api" || request.pathname.startsWith("/api/"))) return false;
  if (EXEMPT(request.pathname)) return false;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return true;
  const origin = request.headers.get("origin");
  // "null": a sandboxed frame, a file, a redirect chain - never this app.
  if (origin !== null && !ownOrigins.includes(origin)) return true;
  return false;
}
