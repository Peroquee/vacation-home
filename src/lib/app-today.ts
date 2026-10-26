/**
 * Today where the app's owner is (GitLab #139): APP_TIMEZONE, Europe/Berlin
 * by default. For what spans properties, such as the calendar, the
 * dashboard and the ledger; a single property's dates use its own timezone
 * (`todayIn` in ./today.ts). Server-side only: it reads the environment.
 */
import { env } from "@/env";
import type { CalendarDate } from "@/lib/calendar-date";

import { todayIn } from "./today";

export function appToday(now = new Date()): CalendarDate {
  return todayIn(env.APP_TIMEZONE, now);
}
