/**
 * The financial report's content (GitLab #90): the dashboard's figures for
 * one filter state, as text in the request's language, ready for the PDF
 * (src/lib/reports/financial-pdf.tsx). Every number comes from the same
 * functions as the dashboard's widgets - the analytics report, buildKpis,
 * breakdownRows, occupancyMonths - so the PDF and the screen agree to the
 * cent. Server-side only.
 */
import { getTranslations } from "next-intl/server";

import { getFormat } from "@/i18n/get-format";
import { breakdownRows } from "@/lib/dashboard/breakdown";
import { buildKpis } from "@/lib/dashboard/kpis";
import type { DashboardState } from "@/lib/dashboard/params";
import { countUpcoming } from "@/lib/dashboard/upcoming";

import { loadReport } from "./data";
import { getKpiWords, occupancyMonths, UPCOMING_DAYS } from "./figures";

export type ReportContent = {
  title: string;
  subtitle: string;
  generated: string;
  kpis: { label: string; value: string; change: string | null; note: string | null }[];
  months: {
    heading: string;
    columns: [string, string, string, string];
    rows: { month: string; income: string; expenses: string; net: string }[];
    /** For the chart: amounts in minor units, and the legend's words. */
    chart: {
      legend: { income: string; expenses: string; net: string };
      points: { label: string; incomeMinor: number; expensesMinor: number; netMinor: number }[];
    };
  };
  categories: {
    heading: string;
    columns: [string, string, string];
    rows: { name: string; amount: string; share: string; color: string | null }[];
    empty: string;
  };
  occupancy: {
    heading: string;
    definition: string;
    columns: [string, string, string, string];
    rows: { month: string; nights: string; rate: string; prior: string }[];
  };
  /** The Kurtaxe collected in the period (GitLab #120), apart from the income; null without. */
  passThrough: string | null;
  footer: string;
};

export type ReportOutcome =
  | { kind: "ok"; content: ReportContent }
  | { kind: "invalid" }
  | { kind: "mixed_currencies"; currencies: string[] }
  | { kind: "not_found" };

export async function buildReportContent(
  state: DashboardState,
  today: string,
  propertyName: string | null,
  now = new Date(),
): Promise<ReportOutcome> {
  const [loaded, upcoming, occupancy, words, format, t, tDash] = await Promise.all([
    loadReport(state),
    countUpcoming(today, UPCOMING_DAYS, state.propertyId),
    occupancyMonths(state),
    getKpiWords(),
    getFormat(),
    getTranslations("dashboard.report"),
    getTranslations("dashboard"),
  ]);
  if (!loaded.ok) return { kind: "invalid" };
  const { result } = loaded;
  if ("error" in result) {
    return result.error === "mixed_currencies"
      ? { kind: "mixed_currencies", currencies: result.currencies }
      : { kind: "not_found" };
  }
  const { report } = result;
  const currency = report.currency;
  const money = (minor: number) => (currency ? format.money(minor, currency) : "–");
  const percent = new Intl.NumberFormat(words.locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const rate = new Intl.NumberFormat(words.locale, { style: "percent", maximumFractionDigits: 0 });
  const monthName = (month: string) =>
    new Intl.DateTimeFormat(words.locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`));
  const shortMonth = (month: string) =>
    new Intl.DateTimeFormat(words.locale, { month: "short", timeZone: "UTC" }).format(
      new Date(`${month}-01T00:00:00Z`),
    );

  const kpis = buildKpis(report, upcoming, words).map((kpi) => ({
    label: kpi.label,
    value: kpi.value,
    change: kpi.delta ? `${kpi.delta.text} ${kpi.delta.against}` : null,
    note: kpi.note ?? null,
  }));
  const range = format.dateRange(state.from, state.until);

  return {
    kind: "ok",
    content: {
      title: t("title"),
      subtitle: propertyName
        ? tDash("descriptionFor", { range, property: propertyName })
        : tDash("description", { range }),
      generated: t("generated", { time: format.dateTime(now, "UTC") }),
      kpis,
      months: {
        heading: currency ? t("monthsIn", { currency }) : t("months"),
        columns: [t("month"), t("income"), t("expenses"), t("net")],
        rows: report.months.map((m) => ({
          month: monthName(m.month),
          income: money(m.incomeMinor),
          expenses: money(m.expensesMinor),
          net: money(m.netMinor),
        })),
        chart: {
          legend: { income: t("income"), expenses: t("expenses"), net: t("net") },
          points: report.months.map((m) => ({
            label: shortMonth(m.month),
            incomeMinor: m.incomeMinor,
            expensesMinor: m.expensesMinor,
            netMinor: m.netMinor,
          })),
        },
      },
      categories: {
        heading: t("categories"),
        columns: [t("category"), t("amount"), t("share")],
        rows: breakdownRows(report.expensesByCategory).map((row) => ({
          name:
            row.kind === "other"
              ? t("other", { names: row.categories.map((c) => c.name).join(", ") })
              : row.name,
          amount: money(row.amountMinor),
          share: row.share === null ? "–" : percent.format(row.share),
          color: row.kind === "category" ? row.color : null,
        })),
        empty: t("noExpenses"),
      },
      occupancy: {
        heading: t("occupancy"),
        definition: tDash("occupancy.description"),
        columns: [t("month"), t("bookedNights"), t("rate"), t("yearBefore")],
        rows: (occupancy ?? []).map((m) => ({
          month: monthName(m.month),
          nights: t("nightsOf", { booked: m.booked, available: m.available }),
          rate: m.rate === null ? "–" : rate.format(m.rate),
          prior: m.priorRate === null ? "–" : rate.format(m.priorRate),
        })),
      },
      passThrough: report.passThroughMinor
        ? t("passThrough", { amount: money(report.passThroughMinor) })
        : null,
      footer: t("footer"),
    },
  };
}
