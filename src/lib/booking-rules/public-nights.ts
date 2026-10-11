/**
 * The public calendar's view of a property (GitLab #108): for each night,
 * only whether a guest could stay it, and for each day whether a stay could
 * start on it. Never why not: a booking, an owner block, an imported stay,
 * a buffer day and a rule all look the same. Pure and client-safe; the
 * public availability endpoint feeds it the taken nights and the rules.
 */
import { addDays, type CalendarDate, daysBetween } from "@/lib/calendar-date";

import { type BookingRules, isoWeekday } from "./rules";

/** The app's longest stay, when the property sets no maximum of its own. */
const LONGEST_STAY = 365;

export type PublicNight = {
  date: CalendarDate;
  /** A guest's stay may include this night. */
  available: boolean;
  /** A stay may start this day: the rules allow it and the shortest stay fits. */
  checkIn: boolean;
};

/**
 * Nights over `[from, to)`. `taken` holds every night a confirmed booking
 * or a block covers (pending requests do not count); the buffer days keep
 * the nights next to them free too, as `checkStay` requires.
 */
export function publicNights(
  { from, to }: { from: CalendarDate; to: CalendarDate },
  taken: ReadonlySet<CalendarDate>,
  rules: BookingRules,
  today: CalendarDate,
): PublicNight[] {
  const longest = rules.maxNights ?? LONGEST_STAY;
  const free = (date: CalendarDate): boolean => {
    const ahead = daysBetween(today, date);
    if (ahead < rules.minLeadDays) return false;
    // Past the last night the latest allowed stay could reach.
    if (rules.horizonDays !== null && ahead > rules.horizonDays + longest - 1) return false;
    for (let offset = -rules.bufferDays; offset <= rules.bufferDays; offset++) {
      if (taken.has(addDays(date, offset))) return false;
    }
    return true;
  };

  // Free nights over the window plus the shortest stay beyond it, so a
  // check-in near the end can be judged.
  const span = daysBetween(from, to) + rules.minNights;
  const freeAt = Array.from({ length: span }, (_, i) => free(addDays(from, i)));

  return Array.from({ length: daysBetween(from, to) }, (_, i) => {
    const date = addDays(from, i);
    const ahead = daysBetween(today, date);
    const startAllowed =
      ahead >= rules.minLeadDays &&
      (rules.horizonDays === null || ahead <= rules.horizonDays) &&
      (rules.checkInWeekdays.length === 0 || rules.checkInWeekdays.includes(isoWeekday(date)));
    const shortestFits = freeAt.slice(i, i + rules.minNights).every(Boolean);
    return { date, available: freeAt[i]!, checkIn: startAllowed && shortestFits };
  });
}

/**
 * The days a stay starting `checkIn` may end on, given the nights: every
 * night up to the day before free, and the length within the rules.
 * Ascending; empty when none.
 */
export function checkOutOptions(
  checkIn: CalendarDate,
  nights: readonly PublicNight[],
  { minNights, maxNights }: Pick<BookingRules, "minNights" | "maxNights">,
): CalendarDate[] {
  const start = nights.findIndex((n) => n.date === checkIn);
  if (start < 0 || !nights[start]!.checkIn) return [];
  const options: CalendarDate[] = [];
  const longest = maxNights ?? LONGEST_STAY;
  for (let length = 1; length <= longest && start + length <= nights.length; length++) {
    if (!nights[start + length - 1]!.available) break;
    if (length >= minNights) options.push(addDays(checkIn, length));
  }
  return options;
}
