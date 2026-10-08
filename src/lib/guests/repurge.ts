/**
 * Re-applies guest erasures after a database restore (DSGVO). Server-side
 * only; run as `npm run guests:repurge -- <ids-file>` (scripts/guests-repurge.ts).
 *
 * A backup taken before an erasure brings the guest back, and the audit
 * record of the erasure lives in the same database, so it is gone too.
 * scripts/backup/restore.sh saves the erased guests' ids before a live
 * restore and lists those that came back; this erases each of them again,
 * with the same purge as the API (src/lib/guests/purge.ts).
 */
import { db } from "@/lib/db";
import { isUuid } from "@/lib/api";

import { purgeGuest } from "./purge";

export type RepurgeSummary = {
  /** Erased now: anonymised (with bookings) or deleted (without). */
  purged: number;
  /** Still erased in this database: nothing to do. */
  alreadyPurged: number;
  /** Not in this database at all, e.g. created after the backup: nothing to erase. */
  notFound: number;
};

/**
 * The ids in a file: one uuid per line. Blank lines and `#` comments are
 * skipped, and repeats count once. `invalidLines` are 1-based line numbers -
 * not their content, which is not shown anywhere.
 */
export function parseIdsFile(text: string): { ids: string[]; invalidLines: number[] } {
  const ids = new Set<string>();
  const invalidLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (isUuid(line)) ids.add(line.toLowerCase());
    else invalidLines.push(index + 1);
  });
  return { ids: [...ids], invalidLines };
}

export async function repurgeGuests(ids: string[]): Promise<RepurgeSummary> {
  const summary: RepurgeSummary = { purged: 0, alreadyPurged: 0, notFound: 0 };
  for (const id of ids) {
    const guest = await db.guest.findUnique({ where: { id }, select: { purgedAt: true } });
    if (!guest) {
      // Gone already: deleted by an erasure on record here, or never existed
      // in this database. Either way there is nothing left to erase.
      const erased = await db.auditEvent.findFirst({
        where: {
          subjectType: "guest",
          subjectId: id,
          action: { in: ["guest.deleted", "guest.purged"] },
        },
        select: { id: true },
      });
      summary[erased ? "alreadyPurged" : "notFound"]++;
      continue;
    }
    if (guest.purgedAt) {
      summary.alreadyPurged++;
      continue;
    }
    // No signed-in user: the audit event records a system actor.
    const result = await purgeGuest(id, null);
    if (result.outcome === "already_purged") summary.alreadyPurged++;
    else if (result.outcome === "not_found") summary.notFound++;
    else summary.purged++;
  }
  return summary;
}
