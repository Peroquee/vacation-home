/**
 * `npm run tokens:rotate`: re-encrypts every stored Google token under the
 * current TOKEN_ENCRYPTION_KEY, the last step of a key rotation
 * (docs/security.md). Run it in the app container:
 *
 *   docker compose exec app npm run tokens:rotate
 *
 * Prints counts only, never a token.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true);

async function main(): Promise<number> {
  const { rotateTokens } = await import("../src/lib/google/rotate");
  const { db } = await import("../src/lib/db");
  try {
    const result = await rotateTokens();
    console.log(`Google connections re-encrypted: ${result.rotated}`);
    console.log(`  already under the current key: ${result.current}`);
    console.log(`  unreadable with any key:       ${result.unreadable}`);
    if (result.unreadable > 0) {
      console.log("Those need Google Calendar reconnecting in settings.");
      return 1;
    }
    console.log("Done. TOKEN_ENCRYPTION_KEYS_OLD can now be emptied.");
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // The type only: the message could quote configuration.
    console.error(`tokens:rotate failed: ${error instanceof Error ? error.name : "error"}`);
    process.exit(1);
  },
);
