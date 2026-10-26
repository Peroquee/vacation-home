/**
 * `npm run income:backfill` (GitLab #137), see scripts/income-backfill.ts:
 * gives the bookings confirmed while booking income was off their income
 * entries, property by property, and lists the hand-typed income linked to
 * no booking, which the owner should check for doubles first.
 *
 * A dry run (the default) does exactly the same work, each property in its
 * own transaction, and rolls it back, so its numbers are those a real run
 * would give. Safe to repeat: a second run finds nothing to do.
 */
import { withPropertyLock } from "@/lib/availability/service";
import { db } from "@/lib/db";

import {
  backfillPropertyIncome,
  type Backfill,
  unlinkedHandIncome,
  type UnlinkedIncome,
} from "./income-automation";

export type PropertyReport = Backfill & {
  propertyId: string;
  name: string;
  currency: string;
  /** Whether its income automation is on; off, nothing is done. */
  enabled: boolean;
  unlinked: UnlinkedIncome[];
};

/** Thrown to roll a dry run's transaction back. */
class DryRun extends Error {
  constructor(readonly report: Backfill) {
    super("dry run");
  }
}

const NOTHING: Backfill = { bookings: 0, entries: 0, amountMinor: 0, skipped: 0 };

export async function runIncomeBackfill({ apply }: { apply: boolean }): Promise<PropertyReport[]> {
  const properties = await db.property.findMany({
    select: {
      id: true,
      name: true,
      currency: true,
      incomeAutomation: { select: { enabled: true } },
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  const reports: PropertyReport[] = [];
  for (const property of properties) {
    const enabled = property.incomeAutomation?.enabled ?? false;
    let backfill = NOTHING;
    if (enabled) {
      try {
        backfill =
          (await withPropertyLock(property.id, async (tx) => {
            const done = await backfillPropertyIncome(property.id, tx);
            if (!apply) throw new DryRun(done);
            return done;
          })) ?? NOTHING;
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
        backfill = error.report;
      }
    }
    reports.push({
      propertyId: property.id,
      name: property.name,
      currency: property.currency,
      enabled,
      ...backfill,
      unlinked: await unlinkedHandIncome(property.id),
    });
  }
  return reports;
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** The report as printed: no guest data, only counts, sums and dates. */
export function formatReport(reports: PropertyReport[], apply: boolean): string[] {
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`${r.name} (${r.propertyId})`);
    if (!r.enabled) {
      lines.push("  booking income is off: nothing to do.");
    } else {
      const verb = apply ? "got" : "would get";
      lines.push(
        `  ${r.bookings} booking(s) ${verb} ${r.entries} income entr${r.entries === 1 ? "y" : "ies"}, ${money(r.amountMinor, r.currency)}.`,
      );
      if (r.skipped > 0) {
        lines.push(
          `  ${r.skipped} booking(s) left alone: income typed in by hand is linked to them.`,
        );
      }
    }
    if (r.unlinked.length > 0) {
      lines.push("  Hand-typed income linked to no booking (check these for doubles):");
      for (const u of r.unlinked) {
        lines.push(
          `    ${u.category}: ${u.count} entr${u.count === 1 ? "y" : "ies"}, ${money(u.amountMinor, r.currency)}, ${day(u.from)} to ${day(u.to)}`,
        );
      }
    }
  }
  lines.push(
    apply
      ? "Done. Running it again changes nothing."
      : "Dry run: nothing was changed. Run with --apply to create the entries.",
  );
  return lines;
}
