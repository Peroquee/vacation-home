"use client";

import { useEffect, useState } from "react";

import type { PropertyCalendar } from "@/lib/availability/calendar";
import { type Conflict, stayConflicts, stayNights } from "@/lib/bookings/form";

export type StayAvailability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "failed" }
  | { state: "checked"; conflicts: Conflict[]; guestNames: ReadonlyMap<string, string> };

type Answer = Exclude<StayAvailability, { state: "idle" } | { state: "checking" }>;

/**
 * Checks a stay against the property's calendar as the dates change, so a
 * taken range shows before submit. Debounced, and stale answers are dropped.
 * Advisory only: the API checks again, under a lock, when the booking is saved.
 */
export function useStayAvailability(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  ignoreBookingId?: string,
): StayAvailability {
  // Each answer remembers what it answered, so a newer question shows as
  // "checking" until its own answer arrives.
  const [answer, setAnswer] = useState<{ key: string; value: Answer } | null>(null);
  const key =
    propertyId !== "" && stayNights(checkIn, checkOut) !== null
      ? `${propertyId}|${checkIn}|${checkOut}|${ignoreBookingId ?? ""}`
      : null;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let value: Answer;
      try {
        const params = new URLSearchParams({ propertyIds: propertyId, from: checkIn, to: checkOut });
        const response = await fetch(`/api/availability?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`The server answered ${response.status}.`);
        const body: { properties: PropertyCalendar[] } = await response.json();
        const calendar = body.properties[0] ?? { bookings: [], blocks: [] };
        value = {
          state: "checked",
          conflicts: stayConflicts({ checkIn, checkOut }, calendar, ignoreBookingId),
          guestNames: new Map(calendar.bookings.map((b) => [b.id, b.guest.name])),
        };
      } catch {
        if (controller.signal.aborted) return;
        value = { state: "failed" };
      }
      if (!controller.signal.aborted) setAnswer({ key, value });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, propertyId, checkIn, checkOut, ignoreBookingId]);

  if (key === null) return { state: "idle" };
  return answer?.key === key ? answer.value : { state: "checking" };
}
