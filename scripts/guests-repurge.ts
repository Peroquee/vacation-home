/**
 * `npm run guests:repurge -- <ids-file>`: erases again every guest listed in
 * the file (one id per line), after a database restore brought them back.
 * See src/lib/guests/repurge.ts and docs/backup-and-restore.md, step 5.
 *
 * Run it in the app container, from the app folder on the Docker host:
 *
 *   docker compose exec app npm run guests:repurge -- backups-restore/erase-again-<stamp>.txt
 *
 * Prints counts only - never a name or any other personal data. Safe to run
 * again: guests already erased are skipped.
 */
import { readFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";

// The same env files `next dev` reads; Compose's DATABASE_URL wins over them.
loadEnvConfig(process.cwd(), true);

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    console.error("Usage: npm run guests:repurge -- <ids-file>");
    return 2;
  }
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    console.error(
      `Cannot read ${path}. Inside the app container, give the path relative to the app folder, e.g. backups-restore/erase-again-<stamp>.txt`,
    );
    return 2;
  }

  // Loaded after the env files, so @/env sees them.
  const { parseIdsFile, repurgeGuests } = await import("../src/lib/guests/repurge");
  const { db } = await import("../src/lib/db");
  const { ids, invalidLines } = parseIdsFile(text);
  if (invalidLines.length > 0) {
    console.error(
      `Not a guest id on line(s) ${invalidLines.join(", ")} of ${path}. Nothing was changed.`,
    );
    return 1;
  }

  try {
    const summary = await repurgeGuests(ids);
    console.log(`Guests in ${path}: ${ids.length}`);
    console.log(`  erased again:    ${summary.purged}`);
    console.log(`  already erased:  ${summary.alreadyPurged}`);
    console.log(`  not found:       ${summary.notFound} (not in this database; nothing to erase)`);
    if (summary.purged > 0) {
      console.log("The app's calendar cache forgets them within a minute.");
    }
    return 0;
  } finally {
    await db.$disconnect();
  }
}

/** The error's type and code, e.g. "PrismaClientKnownRequestError P1001". */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "error";
  // Names the variables and the rule they break, never their values.
  if (error.name === "EnvValidationError") return error.message;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // The message only: an error from the database could quote row data.
    console.error(
      `guests:repurge failed: ${describe(error)}. Run it again; guests already erased are skipped.`,
    );
    process.exit(1);
  },
);
