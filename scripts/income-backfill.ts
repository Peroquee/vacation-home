/**
 * `npm run income:backfill [-- --apply]` (GitLab #137): gives the bookings
 * confirmed while booking income was off their income entries, for every
 * property whose booking income is on. See src/lib/finance/income-backfill.ts.
 *
 * A dry run by default: it prints what it would create, and the hand-typed
 * income linked to no booking, per category, which may be the same income
 * typed in already. Check that list with the owner first; then run it with
 * --apply. Safe to repeat. Run it from the app folder on the Docker host, in
 * development in the app container, on the production server in the tools
 * image (scripts/build-tools.mjs):
 *
 *   docker compose exec app npm run income:backfill
 *   docker compose run --rm migrate npm run income:backfill -- --apply
 *
 * Prints property names, counts, sums and dates only, never a guest. Exits
 * 0 when done, 2 on an error or an unknown option.
 */
import { loadEnvConfig } from "@next/env";

// The same env files `next dev` reads; Compose's DATABASE_URL wins over them.
loadEnvConfig(process.cwd(), true);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--dry-run");
  if (unknown.length > 0 || (args.includes("--apply") && args.includes("--dry-run"))) {
    console.error("Usage: npm run income:backfill [-- --apply]");
    return 2;
  }
  const apply = args.includes("--apply");
  // Loaded after the env files, so @/env sees them.
  const { formatReport, runIncomeBackfill } = await import("../src/lib/finance/income-backfill");
  const { db } = await import("../src/lib/db");
  try {
    for (const line of formatReport(await runIncomeBackfill({ apply }), apply)) console.log(line);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
