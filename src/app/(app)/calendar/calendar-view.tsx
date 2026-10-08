"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { MonthCalendar, type MonthCalendarProps } from "@/components/calendar/month-calendar";

/**
 * Keeps the calendar's month in the URL: navigating loads the new month on
 * the server, so a reload or a shared link shows the same month. A selected
 * free range opens the booking form for it, pre-filled.
 */
export function CalendarView(
  props: Omit<MonthCalendarProps, "onMonthChange" | "bookingHref" | "onSelectRange">,
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <MonthCalendar
      {...props}
      pending={pending}
      bookingHref={(id) => `/bookings/${id}`}
      onSelectRange={({ propertyId, checkIn, checkOut }) =>
        router.push(`/bookings/new?${new URLSearchParams({ propertyId, checkIn, checkOut })}`)
      }
      onMonthChange={(month) =>
        startTransition(() => router.push(`/calendar?month=${month}`, { scroll: false }))
      }
    />
  );
}
