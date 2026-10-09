import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useLocale } from "next-intl";

import { ExpenseBreakdown } from "@/components/charts/expense-breakdown";
import { OccupancyChart } from "@/components/charts/occupancy-chart";
import { OccupancyHeatmap } from "@/components/charts/occupancy-heatmap";
import { RevenueExpensesChart } from "@/components/charts/revenue-expenses-chart";
import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { CardSkeleton, StatTilesSkeleton, TableSkeleton } from "@/components/skeletons";
import { StatTile } from "@/components/stat-tile";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formattersFor } from "@/i18n/format";
import { breakdownRows } from "@/lib/dashboard/breakdown";
import { heatmap } from "@/lib/dashboard/occupancy";

import { InteractiveExamples } from "./interactive-examples";

export const metadata: Metadata = { title: "UI primitives" };

type Stay = { id: string; guest: string; checkIn: string; checkOut: string; totalMinor: number };

/** Formatters for the module-level examples; the page itself uses the request's language. */
const sample = formattersFor("en-GB");

const stays: Stay[] = [
  {
    id: "1",
    guest: "Ada Lovelace",
    checkIn: "2026-07-14",
    checkOut: "2026-07-18",
    totalMinor: 64000,
  },
  {
    id: "2",
    guest: "Grace Hopper",
    checkIn: "2026-07-30",
    checkOut: "2026-08-02",
    totalMinor: 48550,
  },
];

/** Twelve months, one of them empty and one at a loss, to check the chart's edge cases by eye. */
const chartMonths = Array.from({ length: 12 }, (_, i) => {
  const income = i === 3 ? 0 : 90000 + ((i * 37) % 9) * 15000;
  const expenses = i === 3 ? 0 : i === 8 ? 160000 : 25000 + ((i * 53) % 7) * 6000;
  return {
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    incomeMinor: income,
    expensesMinor: expenses,
    netMinor: income - expenses,
  };
});

const columns: Column<Stay>[] = [
  { id: "guest", header: "Guest", cell: (s) => s.guest },
  { id: "dates", header: "Stay", cell: (s) => sample.dateRange(s.checkIn, s.checkOut) },
  { id: "total", header: "Total", cell: (s) => sample.money(s.totalMinor, "EUR"), align: "end" },
];

/**
 * A living gallery of the shared primitives, for development only. The
 * written guide with copyable examples is src/components/README.md.
 */
export default function UiPrimitivesPage() {
  const locale = useLocale();
  const format = formattersFor(locale);
  // A literal read, so the gallery never ships: see eslint.config.mjs.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="space-y-10">
      <PageHeader
        title="UI primitives"
        description="Development-only gallery. Usage is documented in src/components/README.md."
        actions={<Button>Primary action</Button>}
      />

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Occupancy</CardTitle>
            <CardDescription>July 2026</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-medium tabular-nums">74%</CardContent>
        </Card>
      </Section>

      <Section title="Data table">
        <DataTable
          caption="Upcoming stays"
          columns={columns}
          rows={stays}
          rowKey={(s) => s.id}
          empty={<EmptyState title="No upcoming stays" />}
        />
      </Section>

      <Section title="Empty and error states">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            title="No bookings yet"
            description="Bookings you add or import from Google Calendar show up here."
            action={<Button>New booking</Button>}
          />
          <ErrorState description="The bookings could not be loaded." />
        </div>
      </Section>

      <Section title="Loading skeletons">
        <div className="grid gap-4 md:grid-cols-2">
          <TableSkeleton rows={3} columns={3} />
          <CardSkeleton />
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile
            label="Revenue"
            value={sample.money(1284000, "EUR")}
            delta={{
              text: "+12.5%",
              direction: "up",
              good: true,
              against: "vs the same dates last year",
            }}
          />
          <StatTile
            label="Expenses"
            value={sample.money(312000, "EUR")}
            delta={{
              text: "+8%",
              direction: "up",
              good: false,
              against: "vs the same dates last year",
            }}
          />
          <StatTile label="Upcoming bookings" value="3" note="arriving in the next 30 days" />
        </div>
        <StatTilesSkeleton count={3} />
      </Section>

      <Section title="Revenue and expenses chart">
        <Card>
          <CardContent>
            <RevenueExpensesChart currency="EUR" months={chartMonths} />
          </CardContent>
        </Card>
      </Section>

      <Section title="Expense breakdown">
        <Card className="max-w-md">
          <CardContent>
            <ExpenseBreakdown
              currency="EUR"
              rows={breakdownRows(
                [
                  ["Cleaning", 480000, "#7c3aed"],
                  ["Maintenance", 210000, "#db2777"],
                  ["Utilities", 155000, "#ea580c"],
                  ["Platform fees", 98000, "#ca8a04"],
                  ["Supplies", 21000, "#65a30d"],
                  ["Insurance", 14000, "#0284c7"],
                ].map(([name, amountMinor, color]) => ({
                  categoryId: String(name),
                  name: String(name),
                  color: String(color),
                  amountMinor: Number(amountMinor),
                  share: Number(amountMinor) / 978000,
                })),
              )}
            />
          </CardContent>
        </Card>
      </Section>

      <Section title="Occupancy">
        <Card>
          <CardContent className="grid gap-8 lg:grid-cols-2">
            <OccupancyChart
              months={chartMonths.map((m, i) => ({
                month: m.month,
                // A seasonal curve, with one fully blocked month (no rate).
                rate: i === 3 ? null : 0.3 + 0.6 * Math.sin((Math.PI * (i + 1)) / 12) ** 2,
                booked: i === 3 ? 0 : 10 + i,
                available: i === 3 ? 0 : 30,
                priorRate: 0.25 + 0.5 * Math.sin((Math.PI * (i + 1)) / 12) ** 2,
              }))}
            />
            <OccupancyHeatmap
              properties={3}
              months={heatmap(
                { start: "2026-01-01", end: "2027-01-01" },
                [0, 1, 2].map((p) => ({
                  days: Array.from({ length: 365 }, (_, d) => {
                    const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
                    // Busier in summer, each property a little differently.
                    const busy = Math.sin((Math.PI * d) / 365) ** 2 > 0.35 + p * 0.15;
                    return { date, status: busy && (d + p) % 9 !== 0 ? "booked" : "available" };
                  }),
                })),
              )}
            />
          </CardContent>
        </Card>
      </Section>

      <Section title="Dialogs, sheet and toasts">
        <InteractiveExamples />
      </Section>

      <Section title={`Formatting (${locale})`}>
        <dl className="grid max-w-md gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">format.money(123450, &quot;EUR&quot;)</dt>
          <dd>{format.money(123450, "EUR")}</dd>
          <dt className="text-muted-foreground">format.money(1500, &quot;JPY&quot;)</dt>
          <dd>{format.money(1500, "JPY")}</dd>
          <dt className="text-muted-foreground">format.date(&quot;2026-07-14&quot;)</dt>
          <dd>{format.date("2026-07-14")}</dd>
          <dt className="text-muted-foreground">format.dateRange(…)</dt>
          <dd>{format.dateRange("2026-07-14", "2026-07-18")}</dd>
          <dt className="text-muted-foreground">format.dateTime(…, &quot;Europe/Lisbon&quot;)</dt>
          <dd>{format.dateTime("2026-07-14T22:30:00Z", "Europe/Lisbon")}</dd>
        </dl>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
