/**
 * The analytics rules, as pure functions over plain data, so every figure
 * can be checked by hand in tests. The service (./service.ts) loads the data.
 *
 * - **Ranges** are half-open `[from, to)` of calendar dates, like stays.
 *   Months at either end are clipped to the range, so a series from
 *   2026-01-15 starts with a 17-night January.
 * - **Nights**: a night belongs to the date it starts on. A confirmed booking
 *   occupies the nights from check-in up to, not including, check-out;
 *   inquiries and cancelled bookings occupy none.
 * - **Occupancy** = booked nights / available nights. Available nights are
 *   each property's nights in the range, until the day it was archived.
 *   With `excludeBlocks` (the default), nights blocked and not booked are
 *   taken out of the denominator: the owner did not offer them.
 * - **Average nightly rate (ADR)** = accommodation revenue / booked nights;
 *   **revenue per available night (RevPAN)** = accommodation revenue /
 *   available nights. Accommodation revenue is a booking's total less its
 *   cleaning fee, spread evenly over its nights (in whole minor units, the
 *   remainder on the first nights), so a booking across a month boundary
 *   counts in each month for the nights it has there.
 * - **Income, expenses, net** come from the ledger (transactions), by
 *   transaction date.
 * - Money is integer minor units throughout; averages are rounded to whole
 *   minor units, rates to four decimals.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";

export type Month = { month: string; start: CalendarDate; end: CalendarDate };

/** The calendar months `range` touches, each clipped to the range. */
export function monthsIn({ start, end }: DateRange): Month[] {
  const months: Month[] = [];
  let cursor = start;
  while (cursor < end) {
    const [y, m] = cursor.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const monthEnd = next < end ? next : end;
    months.push({ month: cursor.slice(0, 7), start: cursor, end: monthEnd });
    cursor = monthEnd;
  }
  return months;
}

export type PropertyInput = { id: string; archivedOn: CalendarDate | null };
export type BookingInput = {
  propertyId: string;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  totalAmountMinor: number;
  cleaningFeeMinor: number;
};
export type BlockInput = { propertyId: string; startDate: CalendarDate; endDate: CalendarDate };
export type LedgerInput = { date: CalendarDate; type: "income" | "expense"; amountMinor: number };

export type NightStats = {
  bookedNights: number;
  blockedNights: number;
  availableNights: number;
  accommodationRevenueMinor: number;
};

export type MonthStats = Month &
  NightStats & { incomeMinor: number; expensesMinor: number; netMinor: number };

const emptyNights = (): NightStats => ({
  bookedNights: 0,
  blockedNights: 0,
  availableNights: 0,
  accommodationRevenueMinor: 0,
});

/** Each night's share of a booking's accommodation revenue, by night index. */
function nightRevenue(booking: BookingInput): (index: number) => number {
  const nights = daysBetween(booking.checkIn, booking.checkOut);
  const accommodation = Math.max(booking.totalAmountMinor - booking.cleaningFeeMinor, 0);
  const base = Math.floor(accommodation / nights);
  const remainder = accommodation % nights;
  return (index) => base + (index < remainder ? 1 : 0);
}

/** Night statistics for each month of `range`. */
export function nightStats(
  range: DateRange,
  properties: PropertyInput[],
  bookings: BookingInput[],
  blocks: BlockInput[],
  { excludeBlocks = true }: { excludeBlocks?: boolean } = {},
): Map<string, NightStats> {
  const months = monthsIn(range);
  const byMonth = new Map(months.map((m) => [m.month, emptyNights()]));
  const monthOf = (date: CalendarDate) => byMonth.get(date.slice(0, 7))!;
  const inRange = (date: CalendarDate) => date >= range.start && date < range.end;

  for (const property of properties) {
    // Revenue of each booked night; blocked nights, as a set (blocks may overlap).
    const booked = new Map<CalendarDate, number>();
    for (const booking of bookings) {
      if (booking.propertyId !== property.id) continue;
      const revenue = nightRevenue(booking);
      for (
        let i = 0, night = booking.checkIn;
        night < booking.checkOut;
        i++, night = addDays(night, 1)
      ) {
        if (inRange(night)) booked.set(night, revenue(i));
      }
    }
    const blocked = new Set<CalendarDate>();
    for (const block of blocks) {
      if (block.propertyId !== property.id) continue;
      const first = block.startDate > range.start ? block.startDate : range.start;
      for (
        let night = first;
        night < block.endDate && night < range.end;
        night = addDays(night, 1)
      ) {
        blocked.add(night);
      }
    }

    for (let night = range.start; night < range.end; night = addDays(night, 1)) {
      // Archived: no longer offered from that day on.
      if (property.archivedOn && night >= property.archivedOn) break;
      const stats = monthOf(night);
      const revenue = booked.get(night);
      if (revenue !== undefined) {
        stats.bookedNights++;
        stats.accommodationRevenueMinor += revenue;
        stats.availableNights++;
      } else if (blocked.has(night)) {
        // A night both booked and blocked counts as booked: the booking wins.
        stats.blockedNights++;
        if (!excludeBlocks) stats.availableNights++;
      } else {
        stats.availableNights++;
      }
    }
  }
  return byMonth;
}

/** Ledger totals for each month of `range`. */
export function ledgerByMonth(range: DateRange, ledger: LedgerInput[]) {
  const byMonth = new Map(
    monthsIn(range).map((m) => [m.month, { incomeMinor: 0, expensesMinor: 0 }]),
  );
  for (const entry of ledger) {
    if (entry.date < range.start || entry.date >= range.end) continue;
    const month = byMonth.get(entry.date.slice(0, 7))!;
    if (entry.type === "income") month.incomeMinor += entry.amountMinor;
    else month.expensesMinor += entry.amountMinor;
  }
  return byMonth;
}

/** The monthly series: ledger and night statistics side by side. */
export function monthlySeries(
  range: DateRange,
  nights: Map<string, NightStats>,
  ledger: Map<string, { incomeMinor: number; expensesMinor: number }>,
): MonthStats[] {
  return monthsIn(range).map((month) => {
    const money = ledger.get(month.month)!;
    return {
      ...month,
      ...nights.get(month.month)!,
      ...money,
      netMinor: money.incomeMinor - money.expensesMinor,
    };
  });
}

export type Summary = NightStats & {
  incomeMinor: number;
  expensesMinor: number;
  netMinor: number;
  /** Booked / available nights, 0-1; null with no available nights. */
  occupancyRate: number | null;
  /** Average nightly rate; null with no booked nights. */
  averageNightlyRateMinor: number | null;
  /** Revenue per available night; null with no available nights. */
  revenuePerAvailableNightMinor: number | null;
};

const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 10_000) / 10_000);
const average = (a: number, b: number) => (b === 0 ? null : Math.round(a / b));

/** Totals and rates over a whole series. */
export function summarise(months: MonthStats[]): Summary {
  const sum = (key: keyof NightStats | "incomeMinor" | "expensesMinor") =>
    months.reduce((total, month) => total + month[key], 0);
  const nights = {
    bookedNights: sum("bookedNights"),
    blockedNights: sum("blockedNights"),
    availableNights: sum("availableNights"),
    accommodationRevenueMinor: sum("accommodationRevenueMinor"),
  };
  const incomeMinor = sum("incomeMinor");
  const expensesMinor = sum("expensesMinor");
  return {
    ...nights,
    incomeMinor,
    expensesMinor,
    netMinor: incomeMinor - expensesMinor,
    occupancyRate: ratio(nights.bookedNights, nights.availableNights),
    averageNightlyRateMinor: average(nights.accommodationRevenueMinor, nights.bookedNights),
    revenuePerAvailableNightMinor: average(
      nights.accommodationRevenueMinor,
      nights.availableNights,
    ),
  };
}

export type Comparison = "year" | "previous";

/**
 * The equivalent prior period: the same dates a year earlier (`year`;
 * 29 February becomes the 28th), or the same number of days right before
 * (`previous`).
 */
export function priorRange({ start, end }: DateRange, compare: Comparison): DateRange {
  if (compare === "previous") {
    return { start: addDays(start, -daysBetween(start, end)), end: start };
  }
  const yearEarlier = (date: CalendarDate) => {
    const [y, m, d] = date.split("-");
    const day = m === "02" && d === "29" ? "28" : d;
    return `${Number(y) - 1}-${m}-${day}`;
  };
  return { start: yearEarlier(start), end: yearEarlier(end) };
}

type Change = { delta: number; percent: number | null };

/** How each figure moved from the prior period: the difference, and as a percentage of the prior value. */
export function compare(current: Summary, prior: Summary): Record<keyof Summary, Change | null> {
  const change = {} as Record<keyof Summary, Change | null>;
  for (const key of Object.keys(current) as (keyof Summary)[]) {
    const now = current[key];
    const before = prior[key];
    if (now === null || before === null) {
      change[key] = null;
      continue;
    }
    change[key] = {
      delta: Math.round((now - before) * 10_000) / 10_000,
      percent: before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10,
    };
  }
  return change;
}
