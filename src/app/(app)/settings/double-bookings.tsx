import { CalendarX2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formattersFor } from "@/i18n/format";
import type { CalendarDate } from "@/lib/calendar-date";

export type DoubleBookingRow = {
  id: string;
  /** The feed's name, e.g. "Airbnb". */
  feed: string;
  property: string;
  start: CalendarDate;
  end: CalendarDate;
  bookingIds: string[];
};

/**
 * Stays on booking platforms that clash with confirmed bookings here
 * (GitLab #99). There is no "dismiss": a double booking only goes away when
 * one of the two is cancelled, and then it goes by itself.
 */
export function DoubleBookings({ issues }: { issues: DoubleBookingRow[] }) {
  const t = useTranslations("settings.doubleBookings");
  const format = formattersFor(useLocale());
  return (
    <Card id="double-bookings" className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2">
          <CalendarX2 aria-hidden className="size-4" />
          {t("title", { count: issues.length })}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border text-sm">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-baseline justify-between gap-2 p-3">
              <span>
                {t("row", {
                  feed: issue.feed,
                  property: issue.property,
                  range: format.dateRange(issue.start, issue.end),
                })}
              </span>
              <span className="flex gap-3">
                {issue.bookingIds.map((id, i) => (
                  <Link key={id} href={`/bookings/${id}`} className="underline">
                    {t("open", { n: i + 1, count: issue.bookingIds.length })}
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
