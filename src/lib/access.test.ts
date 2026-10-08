import { describe, expect, it } from "vitest";

import { decideAccess, isPublicPath, safeCallbackUrl } from "@/lib/access";
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

  it("sends pages to sign-in, remembering where they were going", () => {
    expect(decideAccess(at("/bookings?status=confirmed"), false)).toEqual({
      kind: "sign-in",
      callbackUrl: "/bookings?status=confirmed",
    });
    expect(decideAccess(at("/"), false)).toEqual({ kind: "sign-in", callbackUrl: "/" });
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
    for (const url of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", ""]) {
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
