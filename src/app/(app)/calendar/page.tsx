import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { getCalendars } from "@/lib/availability/calendar";
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { todayUtc } from "@/lib/bookings/list-params";
import { gridRange, isMonthKey, monthOf, monthWeeks, weekStartFor } from "@/lib/calendar/month";
import { CALENDAR_PROPERTY_COOKIE, resolveChoice } from "@/lib/calendar/property-choice";
import { pricingRulesForMany } from "@/lib/pricing/service";
import { listProperties } from "@/lib/properties/service";
import { getCurrentUser } from "@/lib/session";

import { CalendarView } from "./calendar-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar.page");
  return { title: t("title") };
}

/** The availability API serves at most this many properties at once. */
const MAX_PROPERTIES = 20;

/**
 * `?month=2026-07` picks the month (the current one by default) and
 * `?property=<id>|all` the property; without it, the user's last choice.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const raw = params.month;
  const today = todayUtc();
  const month = typeof raw === "string" && isMonthKey(raw) ? raw : monthOf(today);
  const weekStart = weekStartFor(await getLocale());
  const t = await getTranslations("calendar.page");

  const properties = (await listProperties()).slice(0, MAX_PROPERTIES);
  if (properties.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState
          title={t("noProperties")}
          description={t("noPropertiesHint")}
          action={
            <Link href="/settings" className={buttonVariants()}>
              {t("addProperty")}
            </Link>
          }
        />
      </>
    );
  }

  const [user, jar] = await Promise.all([getCurrentUser(), cookies()]);
  const choice = resolveChoice({
    param: typeof params.property === "string" ? params.property : undefined,
    cookie: jar.get(CALENDAR_PROPERTY_COOKIE)?.value,
    userId: user?.id,
    propertyIds: properties.map((p) => p.id),
  });

  // Everything the grid shows, including the adjacent months' edge days.
  const shown = choice === "all" ? properties.map((p) => p.id) : [choice];
  const range = gridRange(monthWeeks(month, weekStart));
  const [{ calendars }, doubleBookings] = await Promise.all([
    getCalendars(shown, range),
    // Platform stays on confirmed bookings' dates in view (GitLab #99).
    db.calendarSyncIssue.findMany({
      where: {
        kind: "ical_overlap",
        resolvedAt: null,
        propertyId: { in: shown },
        startDate: { lt: toUtcDate(range.end) },
        endDate: { gt: toUtcDate(range.start) },
      },
      include: { feed: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  const byId = new Map(properties.map((p) => [p.id, p]));
  const pricing = await pricingRulesForMany(properties);

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Link href="/bookings/new" className={buttonVariants()}>
            {t("newBooking")}
          </Link>
        }
      />
      <CalendarView
        propertyChoice={choice}
        userId={user?.id ?? null}
        // With one property there is nothing to choose, so no selector.
        properties={
          properties.length > 1 ? properties.map((p) => ({ id: p.id, name: p.name })) : []
        }
        doubleBookings={doubleBookings.map((issue) => ({
          id: issue.id,
          feed: issue.feed?.name ?? "",
          start: fromUtcDate(issue.startDate),
          end: fromUtcDate(issue.endDate),
          bookingIds: issue.bookingIds,
        }))}
        month={month}
        weekStart={weekStart}
        today={today}
        calendars={calendars.map(({ property, bookings, blocks }) => {
          // The selection's price hint: what a new booking would cost, by
          // the same engine and rules as the booking API (GitLab #118).
          const rates = byId.get(property.id);
          return {
            property: {
              id: property.id,
              name: property.name,
              color: property.color,
              pricing: rates && pricing.get(rates.id),
            },
            bookings,
            blocks,
          };
        })}
      />
    </>
  );
}
