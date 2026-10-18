/**
 * A booking's price, made or changed (GitLab #118-#120): when it is worked
 * out anew, when only its Kurtaxe is, and when it stays as agreed. The
 * booking API and the booking form's preview both decide by this, so the
 * owner sees the total that will be saved. Pure and client-safe.
 */
import type { CalendarDate } from "@/lib/calendar-date";

import {
  priceStay,
  type PriceBreakdown,
  type PricingRules,
  repriceTouristTax,
  type StoredBreakdown,
} from "./engine";
import { allAdults, type GuestSplit } from "./tourist-tax";

/** The owner's own Kurtaxe for a booking (an exemption), with an optional note. */
export type ManualTax = { amountMinor: number; note: string | null };

export type PricedFacts = {
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  /** Null: the seasons price the nights. */
  nightlyRateMinor: number | null;
  cleaningFeeMinor: number;
  guests: GuestSplit;
  manualTax: ManualTax | null;
};

/** Who stays on a stored booking: its split, or its count as adults (before #120). */
export function guestsOf(booking: { guestSplit: unknown; guestCount: number }): GuestSplit {
  const split = booking.guestSplit as GuestSplit | null;
  return split && typeof split.adults === "number" && Array.isArray(split.children)
    ? split
    : allAdults(booking.guestCount);
}

/** The owner's Kurtaxe stored on a booking, if any. */
export const manualTaxOf = (booking: {
  touristTaxManualMinor?: number | null;
  touristTaxNote?: string | null;
}): ManualTax | null =>
  booking.touristTaxManualMinor == null
    ? null
    : { amountMinor: booking.touristTaxManualMinor, note: booking.touristTaxNote ?? null };

const sameGuests = (a: GuestSplit, b: GuestSplit) =>
  a.adults === b.adults &&
  JSON.stringify(a.children.filter((c) => c.count > 0)) ===
    JSON.stringify(b.children.filter((c) => c.count > 0));

const sameTax = (a: ManualTax | null, b: ManualTax | null) =>
  a === null ? b === null : b !== null && a.amountMinor === b.amountMinor && a.note === b.note;

/**
 * The breakdown for `next`. A new booking (no `current`) is priced under
 * `rules`. A changed one is priced anew, under today's `rules`, only when
 * its dates, own rate or cleaning fee change or a hand-set total is handed
 * back (`handBack`); a change of guests or of the owner's Kurtaxe re-prices
 * the Kurtaxe alone, by the rules it was priced under; anything else keeps
 * the price as agreed. Throws a RangeError where the engine would.
 */
export function bookingPrice(
  rules: PricingRules,
  next: PricedFacts,
  current?: PricedFacts & { breakdown: StoredBreakdown; handBack?: boolean },
): StoredBreakdown {
  const withTax = (breakdown: PriceBreakdown) =>
    next.manualTax ? repriceTouristTax(breakdown, next, next.manualTax) : breakdown;
  if (
    !current ||
    current.handBack ||
    next.checkIn !== current.checkIn ||
    next.checkOut !== current.checkOut ||
    next.nightlyRateMinor !== current.nightlyRateMinor ||
    next.cleaningFeeMinor !== current.cleaningFeeMinor
  ) {
    return withTax(priceStay(rules, next));
  }
  if (
    current.breakdown.kind === "computed" &&
    (!sameGuests(next.guests, current.guests) || !sameTax(next.manualTax, current.manualTax))
  ) {
    return repriceTouristTax(current.breakdown, next, next.manualTax);
  }
  return current.breakdown;
}
