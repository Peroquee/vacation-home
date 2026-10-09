/**
 * What the dashboard widgets and the PDF report (GitLab #90) both show,
 * computed in one place so the report's figures are the screen's, exactly.
 * Server-side only.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { priorRange } from "@/lib/analytics/rules";
import { addDays } from "@/lib/calendar-date";
import type { KpiWords } from "@/lib/dashboard/kpis";
import { monthlyOccupancy, withPriorYear } from "@/lib/dashboard/occupancy";
import type { DashboardState } from "@/lib/dashboard/params";

import { loadReport } from "./data";

/** How far ahead "upcoming bookings" looks. */
export const UPCOMING_DAYS = 30;

/** The KPI cards' words, in the request's language. */
export async function getKpiWords(): Promise<KpiWords> {
  const t = await getTranslations("dashboard.kpis");
  return {
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
  };
}

/** Occupancy per month, beside the same months a year earlier; null without a report. */
export async function occupancyMonths(state: DashboardState) {
  const year = priorRange({ start: state.from, end: addDays(state.until, 1) }, "year");
  const [current, prior] = await Promise.all([
    loadReport(state),
    loadReport({ ...state, from: year.start, until: addDays(year.end, -1) }),
  ]);
  if (!current.ok || !("report" in current.result)) return null;
  return withPriorYear(
    monthlyOccupancy(current.result.report.months),
    prior.ok && "report" in prior.result ? monthlyOccupancy(prior.result.report.months) : null,
  );
}
