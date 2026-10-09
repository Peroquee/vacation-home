import { CalendarX2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getFormat } from "@/i18n/get-format";
import { fromUtcDate } from "@/lib/calendar-date";
import { openDoubleBookings } from "@/lib/google/sync-issues";

/**
 * Shown on every page while a booking platform has a stay on the dates of
 * a confirmed booking here (GitLab #99): the dates were sold twice, and a
 * guest will arrive to a taken home unless someone acts. Nothing otherwise.
 * Server-rendered, so it needs no polling.
 */
export async function DoubleBookingBanner() {
  const issues = await openDoubleBookings();
  if (issues.length === 0) return null;
  const t = await getTranslations("shell.doubleBooking");
  const format = await getFormat();
  const [first] = issues;

  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
    >
      <CalendarX2 aria-hidden className="size-4 shrink-0" />
      <p className="font-medium">
        {issues.length === 1
          ? t("one", {
              feed: first!.feed?.name ?? "",
              property: first!.property.name,
              range: format.dateRange(fromUtcDate(first!.startDate), fromUtcDate(first!.endDate)),
            })
          : t("many", { count: issues.length })}
      </p>
      <Link href="/settings#double-bookings" className="underline">
        {t("review")}
      </Link>
    </div>
  );
}
