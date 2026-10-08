"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { MonthCalendar, type MonthCalendarProps } from "@/components/calendar/month-calendar";

/**
 * Keeps the calendar's month in the URL: navigating loads the new month on
 * the server, so a reload or a shared link shows the same month.
 */
export function CalendarView(props: Omit<MonthCalendarProps, "onMonthChange" | "bookingHref">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <MonthCalendar
      {...props}
      pending={pending}
      bookingHref={(id) => `/bookings/${id}`}
      onMonthChange={(month) =>
        startTransition(() => router.push(`/calendar?month=${month}`, { scroll: false }))
      }
    />
  );
}
