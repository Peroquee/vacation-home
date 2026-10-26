/**
 * Today's date (GitLab #139). A calendar date only exists in a timezone: at
 * 00:30 in Berlin it is already tomorrow there and still today in UTC. So
 * "today" is always asked for somewhere: where a property is (`todayIn`),
 * or where the app's owner is (`appToday` in ./app-today.ts, server-side).
 * Never `new Date().toISOString().slice(0, 10)`, which is UTC's date; a lint
 * rule (eslint.config.mjs) says so. Client-safe.
 */
import type { CalendarDate } from "@/lib/calendar-date";

/** Today's date in `timezone`, an IANA name such as "Europe/Berlin". */
export function todayIn(timezone: string, now = new Date()): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}
