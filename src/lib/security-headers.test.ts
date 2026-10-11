import { describe, expect, it } from "vitest";

import { commonHeaders, newNonce, pagePolicy, publicPagePolicy } from "./security-headers";

describe("pagePolicy", () => {
  it("allows only nonced scripts, and no framing", () => {
    const policy = pagePolicy("abc", { https: false, dev: false });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("adds eval for development, https upgrades, and the error tracker", () => {
    const policy = pagePolicy("abc", {
      https: true,
      dev: true,
      reportOrigin: "https://glitchtip.lan",
    });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).toContain("connect-src 'self' https://glitchtip.lan");
  });
});

describe("publicPagePolicy", () => {
  it("is the page policy without what only the signed-in app needs", () => {
    const policy = publicPagePolicy("abc", { https: false, dev: false });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).not.toContain("googleusercontent");
    expect(policy).not.toContain("accounts.google.com");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});

describe("commonHeaders", () => {
  it("sends HSTS over https only", () => {
    expect(commonHeaders({ https: true, dev: false })["Strict-Transport-Security"]).toMatch(
      /max-age=31536000/,
    );
    expect(commonHeaders({ https: false, dev: false })).not.toHaveProperty(
      "Strict-Transport-Security",
    );
  });
});

describe("newNonce", () => {
  it("is different every time", () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
