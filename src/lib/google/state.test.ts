import { describe, expect, it } from "vitest";

import { clearStateCookie, newState, stateCookie, stateMatches } from "./state";

describe("connect state", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const cookieValue = (header: string) => header.split(";")[0].split("=").slice(1).join("=");

  it("matches only the same user's state", () => {
    const state = newState();
    const cookie = cookieValue(stateCookie(user, state, false));
    expect(stateMatches(cookie, user, state)).toBe(true);
    expect(stateMatches(cookie, user, newState())).toBe(false);
    expect(stateMatches(cookie, "22222222-2222-4222-8222-222222222222", state)).toBe(false);
    expect(stateMatches(undefined, user, state)).toBe(false);
    expect(stateMatches(cookie, user, null)).toBe(false);
  });

  it("is httpOnly, scoped to the callback, short-lived, and Secure over https", () => {
    const header = stateCookie(user, "s", true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/api/google/callback");
    expect(header).toContain("Max-Age=600");
    expect(header).toContain("Secure");
    expect(stateCookie(user, "s", false)).not.toContain("Secure");
    expect(clearStateCookie(false)).toContain("Max-Age=0");
  });
});
