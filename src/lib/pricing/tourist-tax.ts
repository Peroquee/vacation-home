/**
 * The Kurtaxe (Kurbeitrag, tourist tax; GitLab #120): set by the
 * municipality, charged per person and night, collected by the owner on its
 * behalf - not the owner's income. Everything about it is the owner's to
 * configure, per property; nothing here knows a municipality.
 *
 * - An adult rate per night. Anyone not in a child group pays it.
 * - Child groups by age range (both ends included), each with its rate,
 *   e.g. 0-5 free, 6-15 reduced. Guests are counted by group: no birth
 *   dates (data minimisation).
 * - Optional yearly periods with their own rates (some resorts charge more
 *   in high season), as month and day like the price seasons.
 * - Optionally only the first `maxNights` nights are charged.
 * - Shown "plus Kurtaxe" (added to the total) or "included" (the rates
 *   already contain it; carved out for the ledger).
 *
 * Pure and client-safe, without a validation library (./schema.ts).
 */
import { addDays, type CalendarDate } from "@/lib/calendar-date";

import { covers, type SeasonDates } from "./seasons";

export type ChildGroup = { fromAge: number; toAge: number; rateMinor: number };

/** A period's own rates: the adult rate, and per child group by its key. */
export type TaxPeriod = Omit<SeasonDates, "year"> & {
  name: string;
  adultRateMinor: number;
  /** By groupKey; a group missing here pays its standard rate. */
  childRatesMinor: Record<string, number>;
};

export type TouristTaxRules = {
  adultRateMinor: number;
  childGroups: ChildGroup[];
  periods: TaxPeriod[];
  /** Null: every night is charged. */
  maxNights: number | null;
  /** True: the nightly rates already contain it. */
  included: boolean;
};

/** Who stays, by age group (GitLab #120). guestCount is the sum. */
export type GuestSplit = {
  adults: number;
  children: { fromAge: number; toAge: number; count: number }[];
};

export const groupKey = (group: { fromAge: number; toAge: number }) =>
  `${group.fromAge}-${group.toAge}`;

/** The guests of a booking stored without a split (before #120): all adults. */
export const allAdults = (guestCount: number): GuestSplit => ({ adults: guestCount, children: [] });

export const guestTotal = (split: GuestSplit) =>
  split.adults + split.children.reduce((sum, c) => sum + c.count, 0);

export type TaxLine = {
  /** null: adults. */
  group: { fromAge: number; toAge: number } | null;
  /** The period's name, when its rates applied. */
  period: string | null;
  persons: number;
  nights: number;
  rateMinor: number;
  amountMinor: number;
};

export type TouristTax = {
  included: boolean;
  lines: TaxLine[];
  amountMinor: number;
  /**
   * Set by the owner for this booking (an exemption or reduction under the
   * statute), instead of the lines: "Kurtaxe (manuell)".
   */
  manual?: { note: string | null } | null;
};

/** Whether a date's night falls in a yearly period. */
const periodOn = (rules: TouristTaxRules, date: CalendarDate) =>
  rules.periods.find((p) => covers({ ...p, year: null }, date)) ?? null;

/**
 * The Kurtaxe of a stay from `checkIn`, `nights` long, for `guests`. A
 * child counted in a group the rules no longer have pays the adult rate.
 * Null when nothing is charged.
 */
export function touristTaxFor(
  rules: TouristTaxRules,
  checkIn: CalendarDate,
  nights: number,
  guests: GuestSplit,
): TouristTax | null {
  const charged = rules.maxNights === null ? nights : Math.min(nights, rules.maxNights);
  let adults = guests.adults;
  const persons: { group: ChildGroup | null; count: number }[] = [];
  for (const child of guests.children) {
    const group = rules.childGroups.find((g) => groupKey(g) === groupKey(child));
    if (group) persons.push({ group, count: child.count });
    else adults += child.count;
  }
  persons.unshift({ group: null, count: adults });

  const lines: TaxLine[] = [];
  let date = checkIn;
  for (let i = 0; i < charged; i++, date = addDays(date, 1)) {
    const period = periodOn(rules, date);
    for (const { group, count } of persons) {
      if (count <= 0) continue;
      const rateMinor = group
        ? (period?.childRatesMinor[groupKey(group)] ?? group.rateMinor)
        : (period?.adultRateMinor ?? rules.adultRateMinor);
      // One entry per group, so a line's persons never change; nights add up.
      const key = group ? groupKey(group) : "adults";
      const line = lines.find(
        (l) =>
          (l.group ? groupKey(l.group) : "adults") === key &&
          l.rateMinor === rateMinor &&
          l.period === (period?.name ?? null),
      );
      if (line) line.nights++;
      else {
        lines.push({
          group: group && { fromAge: group.fromAge, toAge: group.toAge },
          period: period?.name ?? null,
          persons: count,
          nights: 1,
          rateMinor,
          amountMinor: 0,
        });
      }
    }
  }
  for (const line of lines) line.amountMinor = line.persons * line.nights * line.rateMinor;
  const charges = lines.filter((line) => line.amountMinor > 0);
  const amountMinor = charges.reduce((sum, line) => sum + line.amountMinor, 0);
  return amountMinor > 0 ? { included: rules.included, lines: charges, amountMinor } : null;
}
