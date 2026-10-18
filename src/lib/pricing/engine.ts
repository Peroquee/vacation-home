/**
 * The one price engine (GitLab #118): every price shown or charged comes
 * from `priceStay` - the public estimate, the booking form's preview, the
 * total a booking is created or re-priced with, and so everything derived
 * from that total (deposit, balance, emails, the guest's page, reports).
 *
 * It returns a breakdown, not just a total: a line per season (a night
 * priced by the season covering it, the default rate outside every season),
 * the cleaning fee, and the total. The length-of-stay discount (#119) and
 * the Kurtaxe (#120) join it here. Integer minor units of the property's
 * currency throughout; the dates are calendar dates in the property's
 * timezone, as bookings store them.
 *
 * Pure and client-safe: the browser runs the same code for the estimate.
 */
import { addDays, type CalendarDate } from "@/lib/calendar-date";
import { MAX_AMOUNT_MINOR, nights as countNights } from "@/lib/bookings/pricing";

import { type Season, seasonOn } from "./seasons";

/** What a property's prices are made of. */
export type PricingRules = {
  currency: string;
  defaultNightlyRateMinor: number;
  defaultCleaningFeeMinor: number;
  seasons: Omit<Season, "id">[];
};

export type NightLine = {
  /** The season's name; null for the default rate or a booking's own rate. */
  season: string | null;
  nights: number;
  rateMinor: number;
  amountMinor: number;
};

/** A computed price, as shown and as kept on a booking. */
export type PriceBreakdown = {
  version: 1;
  kind: "computed";
  currency: string;
  nights: NightLine[];
  nightsMinor: number;
  cleaningFeeMinor: number;
  totalMinor: number;
};

/**
 * A booking made before the engine: only its total is known, and it is
 * kept as it was (the migration's).
 */
export type LegacyBreakdown = { version: 1; kind: "legacy"; currency: string; totalMinor: number };

export type StoredBreakdown = PriceBreakdown | LegacyBreakdown;

export type StayToPrice = {
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  /** A booking's own flat rate for every night, instead of the seasons. */
  nightlyRateMinor?: number | null;
  /** A booking's own cleaning fee, instead of the property's. */
  cleaningFeeMinor?: number | null;
};

function amount(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of minor units`);
  }
  return value;
}

/** The nightly rate on `date` under `rules`: its season's, else the default. */
export function rateOn(rules: PricingRules, date: CalendarDate): number {
  return seasonOn(rules.seasons, date)?.rateMinor ?? rules.defaultNightlyRateMinor;
}

/**
 * The price of a stay. Throws a RangeError for a stay that is not one
 * (check-out not after check-in), a negative or fractional amount, or a
 * total the money column could not store.
 */
export function priceStay(rules: PricingRules, stay: StayToPrice): PriceBreakdown {
  const count = countNights(stay.checkIn, stay.checkOut);
  const own = stay.nightlyRateMinor ?? null;
  const lines: NightLine[] = [];
  if (own !== null) {
    lines.push({
      season: null,
      nights: count,
      rateMinor: amount("nightlyRateMinor", own),
      amountMinor: 0,
    });
  } else {
    let date = stay.checkIn;
    for (let i = 0; i < count; i++, date = addDays(date, 1)) {
      const season = seasonOn(rules.seasons, date);
      const rate = amount("rateMinor", season?.rateMinor ?? rules.defaultNightlyRateMinor);
      const name = season?.name ?? null;
      const line = lines.find((l) => l.season === name && l.rateMinor === rate);
      if (line) line.nights++;
      else lines.push({ season: name, nights: 1, rateMinor: rate, amountMinor: 0 });
    }
  }
  for (const line of lines) line.amountMinor = line.nights * line.rateMinor;
  const nightsMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const cleaningFeeMinor = amount(
    "cleaningFeeMinor",
    stay.cleaningFeeMinor ?? rules.defaultCleaningFeeMinor,
  );
  const totalMinor = nightsMinor + cleaningFeeMinor;
  if (totalMinor > MAX_AMOUNT_MINOR) {
    throw new RangeError(`total ${totalMinor} exceeds the largest storable amount`);
  }
  return {
    version: 1,
    kind: "computed",
    currency: rules.currency,
    nights: lines,
    nightsMinor,
    cleaningFeeMinor,
    totalMinor,
  };
}

/** The price of a stay, or null where priceStay would throw (for previews). */
export function tryPriceStay(rules: PricingRules, stay: StayToPrice): PriceBreakdown | null {
  try {
    return priceStay(rules, stay);
  } catch {
    return null;
  }
}

/**
 * The lowest nightly rate on any night from `from` for `days` days: the
 * public page's "from" price. Null when nothing above zero is charged.
 */
export function lowestRate(rules: PricingRules, from: CalendarDate, days = 365): number | null {
  let lowest: number | null = null;
  let date = from;
  for (let i = 0; i < days; i++, date = addDays(date, 1)) {
    const rate = rateOn(rules, date);
    if (rate > 0 && (lowest === null || rate < lowest)) lowest = rate;
  }
  return lowest;
}

/** Whether a stored value is a breakdown this code can read. */
export function parseBreakdown(value: unknown): StoredBreakdown | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<StoredBreakdown>;
  if (v.version !== 1 || typeof v.totalMinor !== "number" || typeof v.currency !== "string") {
    return null;
  }
  if (v.kind === "legacy") return v as LegacyBreakdown;
  if (v.kind === "computed" && Array.isArray((v as PriceBreakdown).nights)) {
    return v as PriceBreakdown;
  }
  return null;
}
