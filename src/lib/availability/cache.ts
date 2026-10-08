/**
 * A small in-process cache for calendar windows: the calendar asks for the
 * same window repeatedly (navigation back and forth, refocus), and each answer
 * costs several queries.
 *
 * Entries are per property and window. Every write that changes what a window
 * shows invalidates it here - precisely, by date range, for booking writes -
 * and a short TTL bounds staleness from writes made outside the app (the seed
 * script, psql). In-process means one server process; this app runs as one.
 */
import type { DateRange } from "@/lib/date-range";

/** Writes outside the app (seed, psql) show up after at most this long. */
export const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

type Entry<T> = { propertyId: string; range: DateRange; value: T; expires: number };

const entries = new Map<string, Entry<unknown>>();
const key = (propertyId: string, { start, end }: DateRange) => `${propertyId}|${start}|${end}`;

export function readWindow<T>(
  propertyId: string,
  range: DateRange,
  now = Date.now(),
): T | undefined {
  const entry = entries.get(key(propertyId, range));
  if (!entry || entry.expires <= now) return undefined;
  return entry.value as T;
}

export function writeWindow<T>(
  propertyId: string,
  range: DateRange,
  value: T,
  now = Date.now(),
): void {
  // Oldest first in a Map; drop the oldest when full.
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key(propertyId, range), { propertyId, range, value, expires: now + TTL_MS });
}

/**
 * Forgets the cached windows of `propertyId` that overlap any of `ranges` -
 * or all of its windows when no range is given (a property change).
 * Overlap is inclusive of the edges: a stay ending on a window's first day
 * still shows there as a check-out.
 */
export function invalidateWindows(propertyId: string, ranges?: DateRange[]): void {
  for (const [k, entry] of entries) {
    if (entry.propertyId !== propertyId) continue;
    const touched =
      !ranges ||
      ranges.some(({ start, end }) => start <= entry.range.end && entry.range.start <= end);
    if (touched) entries.delete(k);
  }
}

/** Forgets everything, e.g. after erasing a guest whose name windows show. */
export function clearWindows(): void {
  entries.clear();
}
