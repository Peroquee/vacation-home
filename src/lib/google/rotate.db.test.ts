/**
 * Rotating TOKEN_ENCRYPTION_KEY without losing a connection: the new key
 * current, the old one listed as old, then `tokens:rotate`.
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const keys = vi.hoisted(() => {
  // The db test configuration's key (vitest.db.config.mts) becomes the old one.
  const old = "ZGItdGVzdC1rZXktZGItdGVzdC1rZXktZGItdGVzdC0=";
  const current = Buffer.from("rotation-test-key-rotation-test!").toString("base64");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", current);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS_OLD", old);
  return { old, current };
});

import { db } from "@/lib/db";
import { encryptSecret, sealedWith } from "@/lib/secrets";

import { getAccessToken } from "./connection";
import { rotateTokens } from "./rotate";

async function connection(key: string) {
  const user = await db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` } });
  await db.googleConnection.create({
    data: {
      userId: user.id,
      googleAccountId: "g",
      scope: "calendar",
      refreshTokenEncrypted: encryptSecret("refresh", key),
      accessTokenEncrypted: encryptSecret("access-token", key),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return user.id;
}

beforeEach(() => db.googleConnection.deleteMany());
afterAll(() => db.$disconnect());

describe("rotating the token key", () => {
  it("keeps tokens sealed under the old key readable, then re-seals them", async () => {
    const userId = await connection(keys.old);
    expect(await getAccessToken(userId)).toBe("access-token");

    expect(await rotateTokens()).toEqual({ rotated: 1, current: 0, unreadable: 0 });
    const row = await db.googleConnection.findUniqueOrThrow({ where: { userId } });
    expect(sealedWith(row.refreshTokenEncrypted, keys.current)).toBe(true);
    expect(sealedWith(row.accessTokenEncrypted!, keys.current)).toBe(true);
    expect(await getAccessToken(userId)).toBe("access-token");

    // Again: nothing left to do.
    expect(await rotateTokens()).toEqual({ rotated: 0, current: 1, unreadable: 0 });
  });

  it("reports tokens no known key can read, leaving them for a reconnect", async () => {
    await connection(randomBytes(32).toString("base64"));
    await connection(keys.current);
    expect(await rotateTokens()).toEqual({ rotated: 0, current: 1, unreadable: 1 });
  });
});
