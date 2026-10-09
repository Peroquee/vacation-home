/**
 * The dashboard's headline figures, as pure functions over the analytics
 * report (src/lib/analytics). Client-safe.
 *
 * Every change is against the report's prior period. A period with nothing
 * to compare with shows no change rather than "-100%" or "NaN", and a
 * figure with nothing behind it (occupancy without available nights) shows
 * a dash.
 */
import { formatMoney } from "@/lib/format";
import { APP_LOCALE } from "@/lib/locale";

/** The parts of an analytics report the cards read. */
export type ReportTotals = {
  incomeMinor: number;
  expensesMinor: number;
  netMinor: number;
  occupancyRate: number | null;
};

export type Report = {
  currency: string | null;
  totals: ReportTotals;
  prior: { compare: "year" | "previous"; totals: ReportTotals };
};

export type Delta = {
  /** "+12.5%" or "+3.1 pts". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Whether this direction is good news; null when it is neither. */
  good: boolean | null;
  /** "vs the same dates last year", for screen readers and the tile's footnote. */
  against: string;
};

export type Kpi = {
  id: "revenue" | "expenses" | "net" | "margin" | "occupancy" | "upcoming";
  label: string;
  /** The formatted figure, or "–" when there is nothing to show. */
  value: string;
  delta: Delta | null;
  /** A short note under the value, e.g. "next 30 days". */
  note?: string;
};

const percent = new Intl.NumberFormat(APP_LOCALE, {
  style: "percent",
  maximumFractionDigits: 1,
});
const signed = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Net as a share of revenue, 0-1; null without revenue to divide by. */
export function margin(totals: ReportTotals): number | null {
  return totals.incomeMinor === 0 ? null : totals.netMinor / totals.incomeMinor;
}

function against(compare: "year" | "previous"): string {
  return compare === "year" ? "vs the same dates last year" : "vs the previous period";
}

/**
 * The change of an amount in percent of the prior value. Null when the prior
 * value is zero (no percentage of nothing) or both are zero.
 */
export function relativeChange(
  now: number,
  before: number,
  upIsGood: boolean,
  compare: "year" | "previous",
): Delta | null {
  if (before === 0) return null;
  const change = ((now - before) / Math.abs(before)) * 100;
  const rounded = Math.round(change * 10) / 10;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  return {
    text: `${signed.format(rounded)}%`,
    direction,
    good: direction === "flat" ? null : (direction === "up") === upIsGood,
    against: against(compare),
  };
}

/** The change of a rate (0-1) in percentage points; null when either side is missing. */
export function pointsChange(
  now: number | null,
  before: number | null,
  compare: "year" | "previous",
): Delta | null {
  if (now === null || before === null) return null;
  const points = Math.round((now - before) * 1000) / 10;
  const direction = points > 0 ? "up" : points < 0 ? "down" : "flat";
  return {
    text: `${signed.format(points)} pts`,
    direction,
    good: direction === "flat" ? null : direction === "up",
    against: against(compare),
  };
}

/** The six cards, in reading order. `upcoming` is the count of confirmed arrivals ahead. */
export function buildKpis(report: Report, upcoming: { count: number; days: number }): Kpi[] {
  const { totals, prior, currency } = report;
  const money = (minor: number) => (currency ? formatMoney(minor, currency) : "–");
  const compare = prior.compare;
  const nothing = totals.incomeMinor === 0 && totals.expensesMinor === 0;
  const thisMargin = margin(totals);

  return [
    {
      id: "revenue",
      label: "Revenue",
      value: money(totals.incomeMinor),
      delta: relativeChange(totals.incomeMinor, prior.totals.incomeMinor, true, compare),
    },
    {
      id: "expenses",
      label: "Expenses",
      value: money(totals.expensesMinor),
      delta: relativeChange(totals.expensesMinor, prior.totals.expensesMinor, false, compare),
    },
    {
      id: "net",
      label: "Net profit",
      value: nothing ? "–" : money(totals.netMinor),
      delta: nothing ? null : relativeChange(totals.netMinor, prior.totals.netMinor, true, compare),
    },
    {
      id: "margin",
      label: "Profit margin",
      value: thisMargin === null ? "–" : percent.format(thisMargin),
      delta: pointsChange(thisMargin, margin(prior.totals), compare),
    },
    {
      id: "occupancy",
      label: "Occupancy rate",
      value: totals.occupancyRate === null ? "–" : percent.format(totals.occupancyRate),
      delta: pointsChange(totals.occupancyRate, prior.totals.occupancyRate, compare),
    },
    {
      id: "upcoming",
      label: "Upcoming bookings",
      value: String(upcoming.count),
      delta: null,
      note: `arriving in the next ${upcoming.days} days`,
    },
  ];
}
