"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { type Column, DataTable } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { APP_LOCALE } from "@/lib/locale";

export type OccupancyMonth = {
  /** "2026-07". */
  month: string;
  /** 0-1, or null with no available nights. */
  rate: number | null;
  booked: number;
  available: number;
  /** The same month a year earlier, when known. */
  priorRate: number | null;
};

const percent = new Intl.NumberFormat(APP_LOCALE, { style: "percent", maximumFractionDigits: 0 });
const rateText = (rate: number | null) => (rate === null ? "–" : percent.format(rate));
const monthName = (month: string, style: "short" | "long") =>
  new Intl.DateTimeFormat(APP_LOCALE, {
    month: style,
    ...(style === "long" && { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * Occupancy per month as a line, 0-100%. The year before can be shown as a
 * grey line behind it for seasonality: the current year is the point, the
 * prior year context. A month without available nights has no rate and
 * leaves the line open rather than dropping to zero.
 */
export function OccupancyChart({ months }: { months: OccupancyMonth[] }) {
  const [compare, setCompare] = useState(false);
  const hasPrior = months.some((m) => m.priorRate !== null);
  const data = months.map((m) => ({ ...m, label: monthName(m.month, "short") }));

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul
          className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
          aria-label="Legend"
        >
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: "var(--chart-1)" }}
            />
            Occupancy
          </li>
          {compare ? (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: "var(--muted-foreground)" }}
              />
              The year before
            </li>
          ) : null}
        </ul>
        {hasPrior ? (
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="occupancy-compare"
              checked={compare}
              onCheckedChange={(checked) => setCompare(checked)}
            />
            <FieldLabel htmlFor="occupancy-compare" className="text-xs font-normal">
              Compare with the year before
            </FieldLabel>
          </Field>
        ) : null}
      </div>

      <div className="h-56 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              width={44}
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(rate: number) => percent.format(rate)}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as OccupancyMonth | undefined;
                if (!active || !row) return null;
                return (
                  <div className="bg-popover text-popover-foreground ring-foreground/10 rounded-lg px-3 py-2 text-xs shadow-md ring-1">
                    <p className="text-muted-foreground mb-1">{monthName(row.month, "long")}</p>
                    <p>
                      <span className="font-medium">{rateText(row.rate)}</span>{" "}
                      <span className="text-muted-foreground">
                        ({row.booked} of {row.available} nights)
                      </span>
                    </p>
                    {compare ? (
                      <p>
                        <span className="font-medium">{rateText(row.priorRate)}</span>{" "}
                        <span className="text-muted-foreground">the year before</span>
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
            {compare ? (
              <Line
                dataKey="priorRate"
                name="The year before"
                stroke="var(--muted-foreground)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              dataKey="rate"
              name="Occupancy"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          Show the figures as a table
        </summary>
        <DataTable
          className="mt-2"
          caption="Occupancy by month"
          columns={columns}
          rows={months}
          rowKey={(m) => m.month}
          empty={null}
        />
      </details>
    </figure>
  );
}

const columns: Column<OccupancyMonth>[] = [
  { id: "month", header: "Month", cell: (m) => monthName(m.month, "long") },
  {
    id: "nights",
    header: "Booked nights",
    cell: (m) => `${m.booked} of ${m.available}`,
    align: "end",
  },
  { id: "rate", header: "Occupancy", cell: (m) => rateText(m.rate), align: "end" },
  { id: "prior", header: "The year before", cell: (m) => rateText(m.priorRate), align: "end" },
];
