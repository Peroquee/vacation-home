import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { StatTile } from "@/components/stat-tile";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { getApiText } from "@/i18n/get-api-text";
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
  const t = await getTranslations("dashboard.kpis");
  if (!loaded.ok) {
    const apiText = await getApiText();
    return (
      <ErrorState
        title={t("badDates")}
        description={loaded.invalid.issues
          .map((i) => `${i.path.join(".")} ${apiText(i.message)}`)
          .join("; ")}
      />
    );
  }
  const { result } = loaded;

  if ("error" in result) {
    return result.error === "mixed_currencies" ? (
      <EmptyState
        title={t("chooseProperty")}
        description={t("mixedCurrencies", { currencies: result.currencies.join(", ") })}
      />
    ) : (
      <EmptyState
        title={t("notFound")}
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
            {t("showAll")}
          </Link>
        }
      />
    );
  }

  const kpis = buildKpis(result.report, upcoming, {
    locale: await getLocale(),
    labels: {
      revenue: t("labels.revenue"),
      expenses: t("labels.expenses"),
      net: t("labels.net"),
      margin: t("labels.margin"),
      occupancy: t("labels.occupancy"),
      upcoming: t("labels.upcoming"),
    },
    against: { year: t("againstYear"), previous: t("againstPrevious") },
    points: (value) => t("points", { value }),
    upcoming: t("upcomingNote", { days: UPCOMING_DAYS }),
  });
  return (
    <section
      aria-label={t("label")}
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
