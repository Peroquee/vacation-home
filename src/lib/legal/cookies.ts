/**
 * Every cookie the app sets (GitLab #124), for the cookie notice at
 * /stay/legal/cookies and the privacy policy template. Client-safe: the
 * names are written out here, and the test checks them against the code.
 *
 * Guests on the public pages get none: the proxy strips Auth.js's cookies
 * there and nothing else sets any (src/proxy.ts; e2e/public-site.spec.ts).
 * Only the owner's sign-in and the owner's own pages set the ones below,
 * all strictly necessary for what the owner asked for (TTDSG § 25(2) no. 2,
 * ePrivacy Art. 5(3)), so there is no consent banner and nothing to store.
 * No tracking, no third parties: Cloudflare, in front of the site, sets
 * none in this setup (checked on the live site, 2026-10-21).
 *
 * src/lib/legal/cookies.test.ts fails when the app's auth configuration
 * or its own code uses a cookie this list does not name, and
 * e2e/cookies.spec.ts checks the cookies a browser actually receives.
 */

export type CookieInfo = {
  /** As set over https; `alsoAs` over plain http on the LAN. */
  name: string;
  alsoAs?: string;
  /** Message keys under legal.cookies.purposes / .durations. */
  purpose:
    "session" | "csrf" | "callback" | "pkce" | "googleConnect" | "locale" | "calendarProperty";
  duration: "days30" | "browserSession" | "minutes15" | "minutes10" | "year";
  /** Strictly necessary for a service the owner asked for. */
  necessary: true;
};

export const COOKIES: CookieInfo[] = [
  // Auth.js, the owner's sign-in (src/auth.ts).
  {
    name: "__Secure-authjs.session-token",
    alsoAs: "authjs.session-token",
    purpose: "session",
    duration: "days30",
    necessary: true,
  },
  {
    name: "__Host-authjs.csrf-token",
    alsoAs: "authjs.csrf-token",
    purpose: "csrf",
    duration: "browserSession",
    necessary: true,
  },
  {
    name: "__Secure-authjs.callback-url",
    alsoAs: "authjs.callback-url",
    purpose: "callback",
    duration: "browserSession",
    necessary: true,
  },
  {
    name: "__Secure-authjs.pkce.code_verifier",
    alsoAs: "authjs.pkce.code_verifier",
    purpose: "pkce",
    duration: "minutes15",
    necessary: true,
  },
  // The app's own, on the owner's pages only.
  // src/lib/google/state.ts
  {
    name: "google-connect-state",
    purpose: "googleConnect",
    duration: "minutes10",
    necessary: true,
  },
  // src/i18n/locales.ts
  { name: "locale", purpose: "locale", duration: "year", necessary: true },
  // src/lib/calendar/property-choice.ts
  { name: "calendar-property", purpose: "calendarProperty", duration: "year", necessary: true },
];

/** Every name a cookie of the app may carry, either way. */
export const COOKIE_NAMES: string[] = COOKIES.flatMap((c) =>
  c.alsoAs ? [c.name, c.alsoAs] : [c.name],
);
