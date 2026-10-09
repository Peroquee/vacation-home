"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { type Column, DataTable } from "@/components/data-table";
import { formatMoney } from "@/lib/format";
import { APP_LOCALE } from "@/lib/locale";

export type MonthFigures = {
  /** "2026-07". */
  month: string;
  incomeMinor: number;
  expensesMinor: number;
  netMinor: number;
};

/** The series, in the palette's fixed order. Text never wears these colours. */
const SERIES = [
  { key: "incomeMinor", label: "Income", color: "var(--chart-1)", mark: "bar" },
  { key: "expensesMinor", label: "Expenses", color: "var(--chart-2)", mark: "bar" },
  { key: "netMinor", label: "Net profit", color: "var(--chart-3)", mark: "line" },
] as const;

const monthName = (month: string, style: "short" | "long") =>
  new Intl.DateTimeFormat(APP_LOCALE, {
    month: style,
    ...(style === "long" && { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * Income and expenses per month as paired columns, with net profit as a line
 * on the same money axis. One axis only: all three are amounts in the same
 * currency. A month without figures is an explicit zero on the axis, never
 * a gap. The legend and a table view carry identity and every value, so
 * nothing depends on colour or on hovering.
 */
export function RevenueExpensesChart({
  months,
  currency,
}: {
  months: MonthFigures[];
  currency: string;
}) {
  const money = (minor: number) => formatMoney(minor, currency);
  // Whole units on the axis, compact: €12K rather than €12,000.00.
  const tick = new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const data = months.map((m) => ({ ...m, label: monthName(m.month, "short") }));

  return (
    <figure className="space-y-3">
      <ul
        className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
        aria-label="Legend"
      >
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            {/* The legend mirrors the mark: a block for bars, a stroke for the line. */}
            <span
              aria-hidden
              className={series.mark === "bar" ? "size-2.5 rounded-sm" : "h-0.5 w-3 rounded-full"}
              style={{ backgroundColor: series.color }}
            />
            {series.label}
          </li>
        ))}
      </ul>

      <div className="h-72 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="25%"
            barGap={2}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              // On narrow screens fewer labels, never rotated text.
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(minor: number) => tick.format(minor / 10 ** digits)}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={({ active, payload }) => (
                <MonthTooltip active={active} payload={payload} money={money} />
              )}
            />
            {SERIES.filter((s) => s.mark === "bar").map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color}
                maxBarSize={24}
                // Rounded at the data end, square on the baseline.
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
            <Line
              dataKey="netMinor"
              name="Net profit"
              type="monotone"
              stroke="var(--chart-3)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              // >= 8px markers with a 2px ring in the surface colour.
              dot={{ r: 4, fill: "var(--chart-3)", stroke: "var(--card)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "var(--chart-3)", stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          Show the figures as a table
        </summary>
        <DataTable
          className="mt-2"
          caption="Income, expenses and net profit by month"
          columns={tableColumns(money)}
          rows={months}
          rowKey={(m) => m.month}
          empty={null}
        />
      </details>
    </figure>
  );
}

function tableColumns(money: (minor: number) => string): Column<MonthFigures>[] {
  return [
    { id: "month", header: "Month", cell: (m) => monthName(m.month, "long") },
    ...SERIES.map((series): Column<MonthFigures> => ({
      id: series.key,
      header: series.label,
      cell: (m) => money(m[series.key]),
      align: "end",
    })),
  ];
}

/** One month's three figures: values lead, series names follow. */
function MonthTooltip({
  active,
  payload,
  money,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  money: (minor: number) => string;
}) {
  const row = payload?.[0]?.payload as (MonthFigures & { label: string }) | undefined;
  if (!active || !row) return null;
  return (
    <div className="bg-popover text-popover-foreground ring-foreground/10 rounded-lg px-3 py-2 text-xs shadow-md ring-1">
      <p className="text-muted-foreground mb-1">{monthName(row.month, "long")}</p>
      <ul className="space-y-0.5">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            <span className="font-medium tabular-nums">{money(row[series.key])}</span>
            <span className="text-muted-foreground">{series.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
