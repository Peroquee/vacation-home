import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { getCalendars } from "@/lib/availability/calendar";
import { todayUtc } from "@/lib/bookings/list-params";
import { gridRange, isMonthKey, monthOf, monthWeeks, weekStartFor } from "@/lib/calendar/month";
import { APP_LOCALE } from "@/lib/locale";
import { listProperties } from "@/lib/properties/service";

import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

/** The availability API serves at most this many properties at once. */
const MAX_PROPERTIES = 20;

/** `?month=2026-07` picks the month; the current one by default. */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const raw = (await searchParams).month;
  const today = todayUtc();
  const month = typeof raw === "string" && isMonthKey(raw) ? raw : monthOf(today);
  const weekStart = weekStartFor(APP_LOCALE);

  const properties = (await listProperties()).slice(0, MAX_PROPERTIES);
  if (properties.length === 0) {
    return (
      <>
        <PageHeader title="Calendar" />
        <EmptyState
          title="No properties yet"
          description="Add a property to see its bookings here."
          action={
            <Link href="/settings" className={buttonVariants()}>
              Add a property
            </Link>
          }
        />
      </>
    );
  }

  // Everything the grid shows, including the adjacent months' edge days.
  const { calendars } = await getCalendars(
    properties.map((p) => p.id),
    gridRange(monthWeeks(month, weekStart)),
  );

  const byId = new Map(properties.map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          <Link href="/bookings/new" className={buttonVariants()}>
            New booking
          </Link>
        }
      />
      <CalendarView
        month={month}
        weekStart={weekStart}
        today={today}
        calendars={calendars.map(({ property, bookings, blocks }) => {
          // The selection's price hint uses the defaults a new booking gets.
          const rates = byId.get(property.id);
          return {
            property: {
              id: property.id,
              name: property.name,
              color: property.color,
              currency: rates?.currency,
              defaultNightlyRateMinor: rates?.defaultNightlyRateMinor,
              defaultCleaningFeeMinor: rates?.defaultCleaningFeeMinor,
            },
            bookings,
            blocks,
          };
        })}
      />
    </>
  );
}
