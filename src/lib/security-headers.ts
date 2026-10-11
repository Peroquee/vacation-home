/**
 * Security headers for every response, set by src/proxy.ts. Pure, so each
 * rule is testable.
 *
 * Pages get a Content Security Policy with a fresh nonce per request: Next
 * reads the policy from the request and puts the nonce on its own scripts,
 * so only those run ('strict-dynamic' lets them load the app's chunks).
 * Styles allow 'unsafe-inline': the UI components set `style` attributes,
 * which a nonce cannot cover, and styles cannot run code. API responses -
 * JSON, never rendered - get a policy that allows nothing.
 */

export type HeaderOptions = {
  /** Served over https (APP_URL): adds HSTS and upgrades insecure requests. */
  https: boolean;
  /** `next dev` needs eval for React's debugging aids. */
  dev: boolean;
  /** Where the error tracker receives events (the DSN's origin), if set. */
  reportOrigin?: string | null;
};

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function pagePolicy(nonce: string, options: HeaderOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Google account pictures in the account menu.
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self'",
    `connect-src 'self'${options.reportOrigin ? ` ${options.reportOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in posts to Auth.js, which redirects to Google.
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * The public booking site's pages (GitLab #105): the page policy minus
 * what only the signed-in app needs. No outside images (account pictures),
 * forms post only here (no Google sign-in), and no <base>, plugins or
 * framing at all.
 */
export function publicPagePolicy(nonce: string, options: HeaderOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${options.reportOrigin ? ` ${options.reportOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** The headers every response carries, besides the CSP. */
export function commonHeaders(options: HeaderOptions): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Over https only: HSTS on a plain-http LAN address would lock browsers out.
    ...(options.https && { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }),
  };
}
