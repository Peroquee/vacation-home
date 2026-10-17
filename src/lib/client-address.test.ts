import { describe, expect, it } from "vitest";

import { clientAddress } from "./client-address";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("the client's address", () => {
  const sent = headers({
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "198.51.100.1, 172.18.0.5",
  });

  it("is believed from no header when the app is reached directly", () => {
    expect(clientAddress(sent, "none")).toBeNull();
  });

  it("is the first X-Forwarded-For entry behind a reverse proxy", () => {
    expect(clientAddress(sent, "forwarded")).toBe("198.51.100.1");
    expect(clientAddress(headers({}), "forwarded")).toBeNull();
  });

  it("is CF-Connecting-IP behind Cloudflare, never X-Forwarded-For", () => {
    expect(clientAddress(sent, "cloudflare")).toBe("203.0.113.7");
    expect(clientAddress(headers({ "cf-connecting-ip": " 2001:db8::1 " }), "cloudflare")).toBe(
      "2001:db8::1",
    );
    // A request that did not come through Cloudflare (over SSH, say) shares
    // the limit with everyone else rather than picking its own address.
    expect(clientAddress(headers({ "x-forwarded-for": "198.51.100.1" }), "cloudflare")).toBeNull();
  });

  it("is not believed when it is no address at all", () => {
    for (const value of ["", "   ", "unknown", "1.2.3.4, 5.6.7.8", "a".repeat(46), "<script>"]) {
      expect(clientAddress(headers({ "cf-connecting-ip": value }), "cloudflare"), value).toBeNull();
    }
  });
});
