/**
 * Re-encrypts every stored Google token under the current
 * TOKEN_ENCRYPTION_KEY (`npm run tokens:rotate`): the last step of a key
 * rotation, after which TOKEN_ENCRYPTION_KEYS_OLD can be emptied. See
 * docs/security.md. Server-side only.
 *
 * Safe to run at any time and repeatedly: values already under the current
 * key are left alone, and each row is only written if it still holds the
 * value that was read (a token refreshed meanwhile is not overwritten).
 */
import { env } from "@/env";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, SecretKeyMissingError, sealedWith } from "@/lib/secrets";

export type RotationResult = {
  rotated: number;
  current: number;
  /** Sealed under a key that is neither current nor listed as old: needs a reconnect. */
  unreadable: number;
};

export async function rotateTokens(): Promise<RotationResult> {
  const key = env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new SecretKeyMissingError();
  const old = env.TOKEN_ENCRYPTION_KEYS_OLD;
  const result: RotationResult = { rotated: 0, current: 0, unreadable: 0 };

  const reseal = (sealed: string) => encryptSecret(decryptSecret(sealed, key, old), key);

  for (const row of await db.googleConnection.findMany()) {
    const access = row.accessTokenEncrypted;
    const fresh =
      sealedWith(row.refreshTokenEncrypted, key) && (!access || sealedWith(access, key));
    if (fresh) {
      result.current++;
      continue;
    }
    try {
      const { count } = await db.googleConnection.updateMany({
        where: {
          id: row.id,
          refreshTokenEncrypted: row.refreshTokenEncrypted,
          accessTokenEncrypted: access,
        },
        data: {
          refreshTokenEncrypted: reseal(row.refreshTokenEncrypted),
          accessTokenEncrypted: access ? reseal(access) : null,
        },
      });
      // Changed meanwhile (refreshed, reconnected): written under the current key already.
      result[count === 1 ? "rotated" : "current"]++;
    } catch {
      result.unreadable++;
    }
  }
  return result;
}
