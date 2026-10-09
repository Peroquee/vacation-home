import { describe, expect, it } from "vitest";

import { isCrossSiteMutation } from "./csrf";

const OWN = ["http://vacation.lan:3000", "http://192.168.1.20:3000"];
const check = (method: string, pathname: string, headers: Record<string, string> = {}) =>
  isCrossSiteMutation({ method, pathname, headers: new Headers(headers) }, OWN);

describe("isCrossSiteMutation", () => {
  it("refuses another site's writes to the API", () => {
    expect(check("POST", "/api/guests", { origin: "https://evil.example" })).toBe(true);
    expect(check("DELETE", "/api/guests/x", { "sec-fetch-site": "cross-site" })).toBe(true);
    // Same site, other origin (another app on the LAN host): refused too.
    expect(check("PATCH", "/api/bookings/x", { "sec-fetch-site": "same-site" })).toBe(true);
    expect(check("POST", "/api/guests", { origin: "null" })).toBe(true);
  });

  it("allows the app's own writes, from either of its origins", () => {
    expect(check("POST", "/api/guests", { origin: OWN[0], "sec-fetch-site": "same-origin" })).toBe(
      false,
    );
    expect(check("POST", "/api/guests", { origin: OWN[1] })).toBe(false);
  });

  it("leaves reads, pages, Auth.js and the Google webhook alone", () => {
    expect(check("GET", "/api/guests", { "sec-fetch-site": "cross-site" })).toBe(false);
    expect(check("POST", "/settings", { origin: "https://evil.example" })).toBe(false);
    expect(check("POST", "/api/auth/signin/google", { origin: "https://evil.example" })).toBe(
      false,
    );
    expect(check("POST", "/api/google/webhook", { "sec-fetch-site": "cross-site" })).toBe(false);
  });

  it("lets non-browser clients through: CSRF needs a browser", () => {
    expect(check("POST", "/api/guests")).toBe(false);
  });
});
