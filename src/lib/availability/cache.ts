/**
 * A small in-process cache for calendar windows: the calendar asks for the
 * same window repeatedly (navigation back and forth, refocus), and each answer
 * costs several queries.
 *
 * Entries are per property and window. Every write that changes what a window
 * shows must invalidate it here - booking writes do so precisely, by date
 * range; property, guest and block writes broadly - and a short TTL bounds
 * staleness from writes made outside the app (the seed script, psql). In-process
 * means one server process; this app runs as one.
 *
 * Loads and invalidations can interleave: a load that read the database just
 * before a write must not put its stale answer into the cache just after the
 * write's invalidation. So a load takes a `ticket` before it reads, and
 * `writeWindow` drops its answer if any invalidation of that property (or a
 * clear) happened since.
 */
import type { DateRange } from "@/lib/date-range";

/** Writes outside the app (seed, psql) show up after at most this long. */
export const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

type Entry<T> = { propertyId: string; range: DateRange; value: T; expires: number };

const entries = new Map<string, Entry<unknown>>();
const key = (propertyId: string, { start, end }: DateRange) => `${propertyId}|${start}|${end}`;

let clearGeneration = 0;
const propertyGenerations = new Map<string, number>();

export type Ticket = { clear: number; property: number };

/** Taken before reading the database for `propertyId`. */
export function ticket(propertyId: string): Ticket {
  return { clear: clearGeneration, property: propertyGenerations.get(propertyId) ?? 0 };
}

export function readWindow<T>(
  propertyId: string,
  range: DateRange,
  now = Date.now(),
): T | undefined {
  const k = key(propertyId, range);
  const entry = entries.get(k);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    entries.delete(k);
    return undefined;
  }
  // Re-inserted, so the Map's order is least recently used first.
  entries.delete(k);
  entries.set(k, entry);
  return entry.value as T;
}

/**
 * Caches a window - unless the property was invalidated (or the cache
 * cleared) after `since` was taken, in which case the value may be stale and
 * is dropped.
 */
export function writeWindow<T>(
  propertyId: string,
  range: DateRange,
  value: T,
  since: Ticket,
  now = Date.now(),
): void {
  const current = ticket(propertyId);
  if (current.clear !== since.clear || current.property !== since.property) return;

  const k = key(propertyId, range);
  entries.delete(k);
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(k, { propertyId, range, value, expires: now + TTL_MS });
}

/**
 * Forgets the cached windows of `propertyId` that overlap any of `ranges` -
 * or all of its windows when no range is given (a property change). Overlap
 * is inclusive of the edges: a stay ending on a window's first day still
 * shows there as a check-out. Also voids loads of the property in flight.
 */
export function invalidateWindows(propertyId: string, ranges?: DateRange[]): void {
  propertyGenerations.set(propertyId, (propertyGenerations.get(propertyId) ?? 0) + 1);
  for (const [k, entry] of entries) {
    if (entry.propertyId !== propertyId) continue;
    const touched =
      !ranges ||
      ranges.some(({ start, end }) => start <= entry.range.end && entry.range.start <= end);
    if (touched) entries.delete(k);
  }
}

/**
 * Forgets everything and voids every load in flight - e.g. after erasing a
 * guest, whose name windows show and must not show again.
 */
export function clearWindows(): void {
  clearGeneration++;
  entries.clear();
}
