/**
 * Booking rules per property (GitLab #107): the guard rails the owner sets
 * once, so guests cannot request stays the owner would never accept. Pure
 * and client-safe; ./service.ts loads the data and applies them.
 *
 * One check, two strengths. The public site (its calendar and its request
 * API) refuses a stay that breaks a rule; the owner's own booking form only
 * warns, because the owner may make exceptions and records past stays.
 *
 * Stays are half-open, `[checkIn, checkOut)`, as everywhere else: the
 * check-out day is free for the next arrival.
 */
import { addDays, type CalendarDate, daysBetween, toUtcDate } from "@/lib/calendar-date";
import { type DateRange, rangesOverlap } from "@/lib/date-range";

export type BookingRules = {
  /** Fewest nights a stay may have; 1 means any stay. */
  minNights: number;
  /** Most nights a stay may have; null for no limit beyond the app's own. */
  maxNights: number | null;
  /** Days between today and check-in at the least: 0 allows arriving today. */
  minLeadDays: number;
  /** How far ahead check-in may be, in days; null for no limit. */
  horizonDays: number | null;
  /** ISO weekdays (1 = Monday ... 7 = Sunday) a stay may start on; empty for any. */
  checkInWeekdays: number[];
  /** Free nights required between this stay and the one before or after it. */
  bufferDays: number;
};

/** What a property without rules of its own allows: anything. */
export const DEFAULT_RULES: BookingRules = {
  minNights: 1,
  maxNights: null,
  minLeadDays: 0,
  horizonDays: null,
  checkInWeekdays: [],
  bufferDays: 0,
};

export type Stay = { checkIn: CalendarDate; checkOut: CalendarDate };

export type RuleViolation = {
  field: "checkIn" | "checkOut";
  rule:
    | "past"
    | "unavailable"
    | "minNights"
    | "maxNights"
    | "minLeadDays"
    | "horizonDays"
    | "checkInWeekdays"
    | "bufferDays";
  /** A fixed English phrase, translated by the clients (src/i18n/api-text.ts). */
  message: string;
};

export type CheckMode = "public" | "owner";

/** ISO weekday of a date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: CalendarDate): number {
  return toUtcDate(date).getUTCDay() || 7;
}

/**
 * "1 night" or "3 nights". Each count's sentence is its own phrase in the
 * message catalogue (the "1" one written out), so it translates whole.
 */
const plural = (n: number, one: string, other: string) => (n === 1 ? `1 ${one}` : `${n} ${other}`);

/**
 * Every rule `stay` breaks, in field order; empty when it is acceptable.
 *
 * `taken` are the confirmed bookings and blocks of the property (the stay
 * being edited left out), for the buffer days and, on the public site, to
 * refuse taken dates without saying what took them. The owner's form shows
 * conflicts itself, with names, so `owner` mode leaves overlaps out; it
 * also skips the rules about today (past, lead time, horizon) for a stay
 * that started before today: that is a record of the past, not a request.
 */
export function checkStay(
  stay: Stay,
  rules: BookingRules,
  { today, taken, mode }: { today: CalendarDate; taken: DateRange[]; mode: CheckMode },
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const nights = daysBetween(stay.checkIn, stay.checkOut);
  const ahead = daysBetween(today, stay.checkIn);
  const range = { start: stay.checkIn, end: stay.checkOut };

  if (ahead < 0) {
    if (mode === "public") {
      violations.push({ field: "checkIn", rule: "past", message: "cannot be in the past" });
    }
  } else {
    if (ahead < rules.minLeadDays) {
      violations.push({
        field: "checkIn",
        rule: "minLeadDays",
        message: `must be at least ${plural(rules.minLeadDays, "day", "days")} from today`,
      });
    }
    if (rules.horizonDays !== null && ahead > rules.horizonDays) {
      violations.push({
        field: "checkIn",
        rule: "horizonDays",
        message: `can be at most ${plural(rules.horizonDays, "day", "days")} ahead`,
      });
    }
  }
  if (
    rules.checkInWeekdays.length > 0 &&
    !rules.checkInWeekdays.includes(isoWeekday(stay.checkIn))
  ) {
    violations.push({
      field: "checkIn",
      rule: "checkInWeekdays",
      message: "is not a day guests can arrive on",
    });
  }

  const overlapping = taken.some((span) => rangesOverlap(range, span));
  if (overlapping && mode === "public") {
    // Never why: a booking, an owner block and an imported stay look the same.
    violations.push({
      field: "checkIn",
      rule: "unavailable",
      message: "these dates are not available",
    });
  }
  if (rules.bufferDays > 0 && !overlapping) {
    const before = taken.some(
      (span) => span.end <= stay.checkIn && span.end > addDays(stay.checkIn, -rules.bufferDays),
    );
    const after = taken.some(
      (span) =>
        span.start >= stay.checkOut && span.start < addDays(stay.checkOut, rules.bufferDays),
    );
    const free = plural(rules.bufferDays, "free night", "free nights");
    if (before) {
      violations.push({
        field: "checkIn",
        rule: "bufferDays",
        message: `needs ${free} after the stay before`,
      });
    }
    if (after) {
      violations.push({
        field: "checkOut",
        rule: "bufferDays",
        message: `needs ${free} before the next stay`,
      });
    }
  }

  if (nights < rules.minNights) {
    violations.push({
      field: "checkOut",
      rule: "minNights",
      message: `the stay must be at least ${plural(rules.minNights, "night", "nights")}`,
    });
  }
  if (rules.maxNights !== null && nights > rules.maxNights) {
    violations.push({
      field: "checkOut",
      rule: "maxNights",
      message: `the stay can be at most ${plural(rules.maxNights, "night", "nights")}`,
    });
  }
  return violations;
}

/** Violations as a 422's `fields`: one list of messages per field. */
export function violationFields(violations: RuleViolation[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const { field, message } of violations) (fields[field] ??= []).push(message);
  return fields;
}
