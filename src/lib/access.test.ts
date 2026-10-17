import { describe, expect, it } from "vitest";

import { decideAccess, isPublicPath, isPublicSitePath, safeCallbackUrl } from "@/lib/access";
import { isAllowedEmail } from "@/lib/allowed-emails";

const at = (path: string) => {
  const url = new URL(path, "http://localhost");
  return { pathname: url.pathname, search: url.search };
};

describe("decideAccess", () => {
  it("lets a signed-in user through everywhere", () => {
    expect(decideAccess(at("/bookings"), true)).toEqual({ kind: "allow" });
    expect(decideAccess(at("/api/guests"), true)).toEqual({ kind: "allow" });
  });

  it("keeps only the sign-in page and Auth.js routes public", () => {
    expect(decideAccess(at("/signin?error=AccessDenied"), false)).toEqual({ kind: "allow" });
    expect(decideAccess(at("/api/auth/callback/google"), false)).toEqual({ kind: "allow" });
    expect(isPublicPath("/signin-other")).toBe(false);
    expect(isPublicPath("/api/authors")).toBe(false);
  });

  it("lets the health checks through without a session, and nothing beside them", () => {
    expect(decideAccess(at("/api/health"), false)).toEqual({ kind: "allow" });
    expect(decideAccess(at("/api/ready"), false)).toEqual({ kind: "allow" });
    expect(isPublicPath("/api/health/details")).toBe(false);
    expect(isPublicPath("/api/readyz")).toBe(false);
  });

  it("serves the iCal export feeds without a session: their token is the secret", () => {
    expect(isPublicPath("/api/ical/abc.ics")).toBe(true);
    expect(isPublicPath("/api/icalfeeds")).toBe(false);
    expect(isPublicPath("/api/ical-feeds/x")).toBe(false);
  });

  it("sends pages to sign-in, remembering where they were going", () => {
    expect(decideAccess(at("/bookings?status=confirmed"), false)).toEqual({
      kind: "sign-in",
      callbackUrl: "/bookings?status=confirmed",
    });
  });

  it("shows the public start page at the root when signed out, the app when signed in", () => {
    expect(decideAccess(at("/"), false)).toEqual({ kind: "start-page" });
    expect(decideAccess(at("/?utm_source=x"), false)).toEqual({ kind: "start-page" });
    expect(decideAccess(at("/"), true)).toEqual({ kind: "allow" });
    // Only the root itself; the start page's own path is part of the public site.
    expect(isPublicSitePath("/")).toBe(false);
    expect(isPublicSitePath("/stay")).toBe(true);
    expect(isPublicSitePath("/stayover")).toBe(false);
    expect(decideAccess(at("/calendar"), false)).toMatchObject({ kind: "sign-in" });
  });

  it("answers API calls with a 401 rather than a redirect", () => {
    expect(decideAccess(at("/api/properties"), false)).toEqual({ kind: "unauthorized" });
    expect(decideAccess(at("/api"), false)).toEqual({ kind: "unauthorized" });
  });
});

describe("safeCallbackUrl", () => {
  it("keeps paths on this site", () => {
    expect(safeCallbackUrl("/bookings?x=1")).toBe("/bookings?x=1");
  });

  it("refuses anything that could leave the site", () => {
    for (const url of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "evil",
      "",
    ]) {
      expect(safeCallbackUrl(url)).toBe("/calendar");
    }
    expect(safeCallbackUrl(undefined)).toBe("/calendar");
  });
});

describe("isAllowedEmail", () => {
  it("accepts listed addresses in any case and with stray spaces", () => {
    expect(isAllowedEmail("owner@example.test")).toBe(true);
    expect(isAllowedEmail(" OWNER@example.TEST ")).toBe(true);
    expect(isAllowedEmail("partner@example.test")).toBe(true);
  });

  it("refuses anyone else, and no email at all", () => {
    expect(isAllowedEmail("stranger@example.test")).toBe(false);
    expect(isAllowedEmail("owner@example.test.evil")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
  });
});
