import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { CardSkeleton, TableSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateRange, formatDateTime, formatMoney } from "@/lib/format";
import { APP_LOCALE } from "@/lib/locale";

import { InteractiveExamples } from "./interactive-examples";

export const metadata: Metadata = { title: "UI primitives" };

type Stay = { id: string; guest: string; checkIn: string; checkOut: string; totalMinor: number };

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

const columns: Column<Stay>[] = [
  { id: "guest", header: "Guest", cell: (s) => s.guest },
  { id: "dates", header: "Stay", cell: (s) => formatDateRange(s.checkIn, s.checkOut) },
  { id: "total", header: "Total", cell: (s) => formatMoney(s.totalMinor, "EUR"), align: "end" },
];

/**
 * A living gallery of the shared primitives, for development only. The
 * written guide with copyable examples is src/components/README.md.
 */
export default function UiPrimitivesPage() {
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

      <Section title="Dialogs, sheet and toasts">
        <InteractiveExamples />
      </Section>

      <Section title={`Formatting (${APP_LOCALE})`}>
        <dl className="grid max-w-md gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">formatMoney(123450, &quot;EUR&quot;)</dt>
          <dd>{formatMoney(123450, "EUR")}</dd>
          <dt className="text-muted-foreground">formatMoney(1500, &quot;JPY&quot;)</dt>
          <dd>{formatMoney(1500, "JPY")}</dd>
          <dt className="text-muted-foreground">formatDate(&quot;2026-07-14&quot;)</dt>
          <dd>{formatDate("2026-07-14")}</dd>
          <dt className="text-muted-foreground">formatDateRange(…)</dt>
          <dd>{formatDateRange("2026-07-14", "2026-07-18")}</dd>
          <dt className="text-muted-foreground">formatDateTime(…, &quot;Europe/Lisbon&quot;)</dt>
          <dd>{formatDateTime("2026-07-14T22:30:00Z", "Europe/Lisbon")}</dd>
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
