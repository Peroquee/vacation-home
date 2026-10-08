import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  SecretKeyMissingError,
  WrongSecretKeyError,
} from "@/lib/secrets";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");
const token = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-0123456789";

describe("secrets at rest", () => {
  it("round-trip, and never store the plaintext", () => {
    const sealed = encryptSecret(token, key);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, key)).toBe(token);
  });

  it("use a fresh IV each time", () => {
    expect(encryptSecret(token, key)).not.toBe(encryptSecret(token, key));
  });

  it("refuse a wrong key and any tampering", () => {
    const sealed = encryptSecret(token, key);
    expect(() => decryptSecret(sealed, otherKey)).toThrow(WrongSecretKeyError);

    const parts = sealed.split(":");
    const flipped = Buffer.from(parts[4]!, "base64url");
    flipped[0]! ^= 1;
    parts[4] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow(WrongSecretKeyError);
    expect(() => decryptSecret("plain-text-token", key)).toThrow(/Not an encrypted secret/);
  });

  it("need a key", () => {
    expect(() => encryptSecret(token, undefined)).toThrow(SecretKeyMissingError);
  });
});
