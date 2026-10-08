/**
 * Encryption of secrets at rest - Google OAuth tokens - with AES-256-GCM.
 * Server-side only.
 *
 * Stored form: `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url parts). The
 * GCM tag makes any tampering or wrong key fail loudly. `keyId` names the key
 * (a hash prefix, not the key) so a later key rotation can tell which key
 * sealed a value.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretKeyMissingError extends Error {
  constructor() {
    super("TOKEN_ENCRYPTION_KEY is not set; Google Calendar access needs it to store tokens");
    this.name = "SecretKeyMissingError";
  }
}

/** The value was sealed under another key, or tampered with: it cannot be read. */
export class WrongSecretKeyError extends Error {
  constructor() {
    super("This secret was encrypted with a different TOKEN_ENCRYPTION_KEY, or altered");
    this.name = "WrongSecretKeyError";
  }
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64url").slice(0, 8);
}

function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new SecretKeyMissingError();
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, base64Key: string | undefined): string {
  const key = parseKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, keyId(key), iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

export function decryptSecret(sealed: string, base64Key: string | undefined): string {
  const key = parseKey(base64Key);
  const [version, id, iv, tag, ciphertext] = sealed.split(":");
  if (version !== VERSION || !id || !iv || !tag || ciphertext === undefined) {
    throw new Error("Not an encrypted secret");
  }
  if (id !== keyId(key)) throw new WrongSecretKeyError();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new WrongSecretKeyError();
  }
}
