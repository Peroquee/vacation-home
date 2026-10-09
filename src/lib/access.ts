/**
 * Who may see what. Pure, so the rule is testable on its own; src/proxy.ts
 * applies it to every request.
 */

/**
 * Reachable without a session: the sign-in page, Auth.js's own routes,
 * Google's push notifications, which carry their own secret (checked by
 * the route against the stored channel), and the health checks.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/google/webhook" ||
    // Health checks for Docker and the reverse proxy; they reveal nothing.
    pathname === "/api/health" ||
    pathname === "/api/ready"
  );
}

export type AccessDecision =
  | { kind: "allow" }
  /** API callers get a 401 to handle; they cannot follow a sign-in page. */
  | { kind: "unauthorized" }
  /** Pages go to sign-in, and come back to where they were afterwards. */
  | { kind: "sign-in"; callbackUrl: string };

export function decideAccess(
  { pathname, search }: { pathname: string; search: string },
  signedIn: boolean,
): AccessDecision {
  if (signedIn || isPublicPath(pathname)) return { kind: "allow" };
  if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "unauthorized" };
  return { kind: "sign-in", callbackUrl: `${pathname}${search}` };
}

/**
 * A post-sign-in destination taken from the URL, kept only if it stays on
 * this site. Resolved the way a browser would - which ignores tabs and
 * newlines, so "/<tab>/evil.example" means "//evil.example" - and accepted
 * only if the origin did not change. Never an open redirect.
 */
export function safeCallbackUrl(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const fallback = "/calendar";
  if (!raw?.startsWith("/")) return fallback;

  const base = "http://app.invalid";
  try {
    const url = new URL(raw, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
