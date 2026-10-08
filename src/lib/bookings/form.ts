/**
 * Helpers for the booking form. Client-safe: no database access.
 *
 * The form checks availability as the dates change, against the same rules
 * the API enforces on submit (src/lib/availability/rules.ts), so a taken
 * range shows up before anything is sent.
 */
// Types only: the calendar module itself is server-side.
import type { CalendarBlock, CalendarBooking } from "@/lib/availability/calendar";
import { type Conflict, findConflicts } from "@/lib/availability/rules";
import { addDays, daysBetween, isCalendarDate } from "@/lib/calendar-date";
import { formatDate, formatDateRange } from "@/lib/format";

import { calculateTotalMinor } from "./pricing";
import { stayProblem } from "./schema";

export type { Conflict };

export type PropertyChoice = {
  id: string;
  name: string;
  currency: string;
  defaultNightlyRateMinor: number;
  defaultCleaningFeeMinor: number;
};

/** Just what the form needs of a property, so nothing else reaches the client. */
export function toPropertyChoice(property: PropertyChoice): PropertyChoice {
  const { id, name, currency, defaultNightlyRateMinor, defaultCleaningFeeMinor } = property;
  return { id, name, currency, defaultNightlyRateMinor, defaultCleaningFeeMinor };
}

/** Nights, or null while the dates do not make a valid stay yet. */
export function stayNights(checkIn: string, checkOut: string): number | null {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return null;
  if (stayProblem(checkIn, checkOut)) return null;
  return daysBetween(checkIn, checkOut);
}

/**
 * The total the API would calculate, or null while the dates or rates are
 * incomplete or the result could not be stored.
 */
export function previewTotalMinor(stay: {
  checkIn: string;
  checkOut: string;
  nightlyRateMinor: number | null;
  cleaningFeeMinor: number | null;
}): number | null {
  const { checkIn, checkOut, nightlyRateMinor, cleaningFeeMinor } = stay;
  if (stayNights(checkIn, checkOut) === null) return null;
  if (nightlyRateMinor === null || cleaningFeeMinor === null) return null;
  try {
    return calculateTotalMinor({ checkIn, checkOut, nightlyRateMinor, cleaningFeeMinor });
  } catch {
    return null;
  }
}

/**
 * What stands in the way of a stay, from a property's calendar as
 * GET /api/availability returns it. `ignoreBookingId` is the booking being
 * edited, which never conflicts with itself.
 */
export function stayConflicts(
  stay: { checkIn: string; checkOut: string },
  calendar: { bookings: CalendarBooking[]; blocks: CalendarBlock[] },
  ignoreBookingId?: string,
): Conflict[] {
  if (stayNights(stay.checkIn, stay.checkOut) === null) return [];
  return findConflicts(
    { start: stay.checkIn, end: stay.checkOut },
    calendar.bookings.map((b) => ({
      id: b.id,
      start: b.checkIn,
      end: b.checkOut,
      status: b.status,
    })),
    calendar.blocks.map((b) => ({
      id: b.id,
      start: b.startDate,
      end: b.endDate,
      reason: b.reason,
      origin: b.origin,
    })),
    { ignoreBookingId },
  );
}

/** "Booked by Ada Lovelace, Jul 14 – 18, 2026" / "Blocked: renovation, …". */
export function describeConflict(
  conflict: Conflict,
  guestNames: ReadonlyMap<string, string> = new Map(),
): string {
  const when = formatDateRange(conflict.start, conflict.end);
  if (conflict.kind === "booking") {
    const guest = guestNames.get(conflict.id);
    return guest ? `Booked by ${guest}, ${when}` : `Booked, ${when}`;
  }
  const why = conflict.reason ?? (conflict.origin === "google" ? "Google Calendar" : null);
  return why ? `Blocked (${why}), ${when}` : `Blocked, ${when}`;
}

/**
 * When a stay misses a changeover by one night, how to fix it. Check-out is
 * exclusive: a guest may arrive on the day another leaves, so a stay
 * starting the night before someone's check-out day, or ending the morning
 * after someone's check-in day, is one night off a valid changeover.
 * Null for any other overlap.
 */
export function turnoverFix(
  stay: { checkIn: string; checkOut: string },
  conflict: Conflict,
): { move: "checkIn" | "checkOut"; to: string; message: string } | null {
  const day = (date: string) => formatDate(date, { style: "long" });
  if (conflict.start < stay.checkIn && conflict.end === addDays(stay.checkIn, 1)) {
    return {
      move: "checkIn",
      to: conflict.end,
      message: `Arrive on ${day(conflict.end)} instead: guests can arrive on the day the previous stay checks out, but not the day before.`,
    };
  }
  if (conflict.end > stay.checkOut && conflict.start === addDays(stay.checkOut, -1)) {
    return {
      move: "checkOut",
      to: conflict.start,
      message: `Leave on ${day(conflict.start)} instead: a stay can check out on the day the next one checks in, but not the day after.`,
    };
  }
  return null;
}
