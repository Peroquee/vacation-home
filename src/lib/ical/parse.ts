/**
 * Reads a booking platform's iCal feed (RFC 5545) into the nights it blocks.
 * Parsing is ical.js's; this decides what blocks. Pure, so it is tested on
 * the platforms' real feed shapes (parse.test.ts).
 *
 * - **What blocks**: every event, except cancelled ones and ones marked free
 *   (TRANSP:TRANSPARENT). Airbnb and Booking.com publish whole-day events
 *   ("Reserved", "Not available", "CLOSED - Not available") on their own
 *   dates, end exclusive, like a block. A timed event blocks every night it
 *   touches, in the property's timezone: a stay is never shorter than a night.
 * - **No personal data**: only the UID and the dates are kept. Summaries and
 *   descriptions (Airbnb's carry a reservation link and phone digits) never
 *   leave this module.
 * - **Recurring events** are taken at their first occurrence; the platforms
 *   do not use them for stays.
 */
import ICAL from "ical.js";

import { addDays, type CalendarDate, isCalendarDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";

export type FeedEvent = DateRange & {
  /** The event's UID: the same stay keeps it from one fetch to the next. */
  uid: string;
};

export class FeedParseError extends Error {}

/** The local calendar date of an instant in `timezone`. */
function localDate(instant: Date, timezone: string): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(instant);
}

/** The blocking events of a feed, one per UID (the last wins). Throws FeedParseError. */
export function parseFeed(text: string, timezone: string): FeedEvent[] {
  let calendar: InstanceType<typeof ICAL.Component>;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new FeedParseError("not an iCalendar file");
  }
  if (calendar.name !== "vcalendar") throw new FeedParseError("not a VCALENDAR");

  // Times given in the feed's own timezones (TZID) need their definitions.
  for (const zone of calendar.getAllSubcomponents("vtimezone")) {
    const tzid = zone.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(zone);
    }
  }

  const byUid = new Map<string, FeedEvent>();
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const nights = blockedNights(component, timezone);
    if (nights) byUid.set(nights.uid, nights);
  }
  return [...byUid.values()];
}

function blockedNights(
  component: InstanceType<typeof ICAL.Component>,
  timezone: string,
): FeedEvent | null {
  const status = String(component.getFirstPropertyValue("status") ?? "").toUpperCase();
  const transparency = String(component.getFirstPropertyValue("transp") ?? "").toUpperCase();
  if (status === "CANCELLED" || transparency === "TRANSPARENT") return null;

  const uid = String(component.getFirstPropertyValue("uid") ?? "").trim();
  if (!uid || !component.hasProperty("dtstart")) return null;

  let event: InstanceType<typeof ICAL.Event>;
  try {
    event = new ICAL.Event(component);
  } catch {
    return null;
  }
  const start = event.startDate;
  const hasEnd = component.hasProperty("dtend") || component.hasProperty("duration");

  if (start.isDate) {
    const first = start.toString().slice(0, 10);
    // No end on a date event means one day (RFC 5545, 3.6.1).
    const end = hasEnd ? event.endDate.toString().slice(0, 10) : addDays(first, 1);
    if (!isCalendarDate(first) || !isCalendarDate(end)) return null;
    return end > first ? { uid, start: first, end } : { uid, start: first, end: addDays(first, 1) };
  }

  const first = localDate(start.toJSDate(), timezone);
  const endDay = hasEnd ? localDate(event.endDate.toJSDate(), timezone) : first;
  return { uid, start: first, end: endDay > first ? endDay : addDays(first, 1) };
}
