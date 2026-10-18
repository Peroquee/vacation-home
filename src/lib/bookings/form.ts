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

import { type PriceBreakdown, type PricingRules, tryPriceStay } from "@/lib/pricing/engine";

import { stayProblem } from "./values";

export type { Conflict };

export type PropertyChoice = {
  id: string;
  name: string;
  currency: string;
  defaultCleaningFeeMinor: number;
  /** What the preview prices a stay by: the same rules as the API (GitLab #118). */
  pricing: PricingRules;
};

/** Just what the form needs of a property, so nothing else reaches the client. */
export function toPropertyChoice(
  property: {
    id: string;
    name: string;
    currency: string;
    defaultNightlyRateMinor: number;
    defaultCleaningFeeMinor: number;
  },
  /** Its pricing rules (src/lib/pricing/service.ts); without, its defaults alone. */
  pricing?: PricingRules,
): PropertyChoice {
  const { id, name, currency, defaultNightlyRateMinor, defaultCleaningFeeMinor } = property;
  return {
    id,
    name,
    currency,
    defaultCleaningFeeMinor,
    pricing: pricing ?? {
      currency,
      defaultNightlyRateMinor,
      defaultCleaningFeeMinor,
      seasons: [],
      discounts: [],
    },
  };
}

/** Nights, or null while the dates do not make a valid stay yet. */
export function stayNights(checkIn: string, checkOut: string): number | null {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return null;
  if (stayProblem(checkIn, checkOut)) return null;
  return daysBetween(checkIn, checkOut);
}

/**
 * The price the API would calculate (GitLab #118): the same engine on the
 * same rules. Null while the dates or amounts are incomplete or the total
 * could not be stored. `nightlyRateMinor` null prices by the seasons.
 */
export function previewPrice(
  pricing: PricingRules,
  stay: {
    checkIn: string;
    checkOut: string;
    nightlyRateMinor: number | null;
    cleaningFeeMinor: number | null;
  },
): PriceBreakdown | null {
  const { checkIn, checkOut, nightlyRateMinor, cleaningFeeMinor } = stay;
  if (stayNights(checkIn, checkOut) === null || cleaningFeeMinor === null) return null;
  return tryPriceStay(pricing, { checkIn, checkOut, nightlyRateMinor, cleaningFeeMinor });
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

// The words for a conflict and a fix: src/components/use-conflict-text.ts.

export type TurnoverFix = { move: "checkIn" | "checkOut"; to: string };

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
): TurnoverFix | null {
  if (conflict.start < stay.checkIn && conflict.end === addDays(stay.checkIn, 1)) {
    return {
      move: "checkIn",
      to: conflict.end,
    };
  }
  if (conflict.end > stay.checkOut && conflict.start === addDays(stay.checkOut, -1)) {
    return {
      move: "checkOut",
      to: conflict.start,
    };
  }
  return null;
}
