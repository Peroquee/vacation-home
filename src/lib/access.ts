/**
 * Who may see what. Pure, so the rule is testable on its own; src/proxy.ts
 * applies it to every request.
 */

/** Reachable without a session: the sign-in page and Auth.js's own routes. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/signin" || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
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
 * A post-sign-in destination taken from the URL, kept only if it is a path on
 * this site - never `//evil.example` or `https://...`, which would make the
 * sign-in page an open redirect.
 */
export function safeCallbackUrl(value: string | string[] | undefined): string {
  const url = Array.isArray(value) ? value[0] : value;
  return url && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")
    ? url
    : "/calendar";
}
