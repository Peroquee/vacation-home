/**
 * `npm run bookings:check`: lists the bookings whose status disagrees with
 * their own record (GitLab #135), e.g. cancelled with no cancellation
 * recorded, or a website booking confirmed without its deposit. Left by
 * status edits made before every change had to go through its action; see
 * src/lib/bookings/status-check.ts.
 *
 * Read only: it changes nothing. Open each booking it names at
 * /bookings/<id> and put it right with the booking's actions. Run it from
 * the app folder on the Docker host, in development in the app container,
 * on the production server in the tools image (scripts/build-tools.mjs):
 *
 *   docker compose exec app npm run bookings:check
 *   docker compose run --rm migrate npm run bookings:check
 *
 * Prints booking ids and statuses only, never a name. Exits 0 when nothing
 * is found, 1 when something is (so a script can tell), 2 on an error.
 */
import { loadEnvConfig } from "@next/env";

// The same env files `next dev` reads; Compose's DATABASE_URL wins over them.
loadEnvConfig(process.cwd(), true);

async function main(): Promise<number> {
  // Loaded after the env files, so @/env sees them.
  const { findStatusProblems, PROBLEM_TEXT } = await import("../src/lib/bookings/status-check");
  const { db } = await import("../src/lib/db");
  try {
    const findings = await findStatusProblems();
    if (findings.length === 0) {
      console.log("Every booking's status agrees with its record.");
      return 0;
    }
    console.log(`${findings.length} booking status problem(s); nothing was changed:`);
    for (const { bookingId, status, problem } of findings) {
      console.log(`  /bookings/${bookingId}  (${status})  ${PROBLEM_TEXT[problem]}`);
    }
    return 1;
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
