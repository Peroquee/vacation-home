import { describe, expect, it } from "vitest";

import { REDACTED, scrub, scrubString } from "@/lib/scrub";

const GOOGLE_ACCESS = "ya29.a0AfB_byC1x2Y3z4-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const GOOGLE_REFRESH = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-0123456789";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl";

describe("scrubString", () => {
  it("masks email addresses anywhere in a string", () => {
    expect(scrubString("No booking for ada.lovelace+test@example.co.uk, sorry")).toBe(
      "No booking for [email], sorry",
    );
  });

  it("masks OAuth tokens, JWTs and authorization headers", () => {
    expect(scrubString(`token ${GOOGLE_ACCESS} refresh ${GOOGLE_REFRESH}`)).toBe(
      `token ${REDACTED} refresh ${REDACTED}`,
    );
    expect(scrubString(`id_token is ${JWT}`)).toBe(`id_token is ${REDACTED}`);
    expect(scrubString("Authorization: Bearer abc.def-123")).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it("masks token-bearing query parameters but keeps the rest of the URL", () => {
    expect(scrubString("GET /callback?state=xyz&code=4/0Ab12&scope=calendar")).toBe(
      `GET /callback?state=xyz&code=${REDACTED}&scope=calendar`,
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Synced 3 events for property 42 at 2026-07-14T10:00:00Z";
    expect(scrubString(text)).toBe(text);
  });
});

describe("scrub", () => {
  it("redacts sensitive keys in any spelling, at any depth", () => {
    const input = {
      guest: { name: "Ada", email: "ada@example.com", phoneNumber: "+351 900 000 000" },
      oauth: { access_token: "abc", refreshToken: "def", "Id-Token": "ghi" },
      headers: { authorization: "Basic xyz", cookie: "session=1", accept: "*/*" },
    };
    expect(scrub(input)).toEqual({
      guest: { name: "Ada", email: REDACTED, phoneNumber: REDACTED },
      oauth: { access_token: REDACTED, refreshToken: REDACTED, "Id-Token": REDACTED },
      headers: { authorization: REDACTED, cookie: REDACTED, accept: "*/*" },
    });
  });

  it("turns errors into plain objects and scrubs their message and stack", () => {
    const error = new Error("Guest ada@example.com not found");
    const scrubbed = scrub({ err: error }) as { err: Record<string, string> };

    expect(scrubbed.err.type).toBe("Error");
    expect(scrubbed.err.message).toBe("Guest [email] not found");
    expect(scrubbed.err.stack).toContain("Guest [email] not found");
    expect(JSON.stringify(scrubbed)).not.toContain("ada@example.com");
  });

  it("does not modify its input, and survives cycles", () => {
    const input: Record<string, unknown> = { email: "ada@example.com" };
    input.self = input;
    const scrubbed = scrub(input);

    expect(input.email).toBe("ada@example.com");
    expect(scrubbed).toEqual({ email: REDACTED, self: "[circular]" });
  });
});
