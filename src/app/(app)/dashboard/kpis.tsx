import Link from "next/link";

import { StatTile } from "@/components/stat-tile";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { buildKpis } from "@/lib/dashboard/kpis";
import type { DashboardState } from "@/lib/dashboard/params";
import { countUpcoming } from "@/lib/dashboard/upcoming";

import { loadReport } from "./data";

/** How far ahead "upcoming bookings" looks. */
export const UPCOMING_DAYS = 30;

/** The headline figures for the range, streamed in behind a skeleton. */
export async function Kpis({ state, today }: { state: DashboardState; today: string }) {
  const [loaded, upcoming] = await Promise.all([
    loadReport(state),
    countUpcoming(today, UPCOMING_DAYS, state.propertyId),
  ]);
  if (!loaded.ok) {
    return (
      <ErrorState
        title="These dates can't be shown"
        description={loaded.invalid.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}
      />
    );
  }
  const { result } = loaded;

  if ("error" in result) {
    return result.error === "mixed_currencies" ? (
      <EmptyState
        title="Choose a property"
        description={`Your properties use different currencies (${result.currencies.join(", ")}), and amounts in different currencies can't be added up.`}
      />
    ) : (
      <EmptyState
        title="Property not found"
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
            Show all properties
          </Link>
        }
      />
    );
  }

  const kpis = buildKpis(result.report, { count: upcoming, days: UPCOMING_DAYS });
  return (
    <section
      aria-label="Key figures"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      {kpis.map((kpi) => (
        <StatTile
          key={kpi.id}
          label={kpi.label}
          value={kpi.value}
          delta={kpi.delta}
          note={kpi.note}
        />
      ))}
    </section>
  );
}
