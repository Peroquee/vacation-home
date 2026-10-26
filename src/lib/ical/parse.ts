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
 * - **Unreadable events** (no start, no UID, dates that make no sense) are
 *   named, never silently dropped (GitLab #144): to the importer an event
 *   it can't read is not a stay cancelled on the platform.
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

export type FeedRead = {
  /** The blocking events, one per UID (the last wins). */
  events: FeedEvent[];
  /** UIDs of events it couldn't read, and no readable event has. */
  unreadable: string[];
  /** Events it couldn't read that have no UID either. */
  unreadableWithoutUid: number;
};

/** The blocking events of a feed, one per UID (the last wins). Throws FeedParseError. */
export function parseFeed(text: string, timezone: string): FeedEvent[] {
  return readFeed(text, timezone).events;
}

/** A feed's blocking events, and the events it couldn't read. Throws FeedParseError. */
export function readFeed(text: string, timezone: string): FeedRead {
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
  const unreadable = new Set<string>();
  let unreadableWithoutUid = 0;
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const nights = blockedNights(component, timezone);
    if (nights === "free") continue;
    if (nights === "unreadable") {
      const uid = uidOf(component);
      if (uid) unreadable.add(uid);
      else unreadableWithoutUid++;
    } else {
      byUid.set(nights.uid, nights);
    }
  }
  return {
    events: [...byUid.values()],
    unreadable: [...unreadable].filter((uid) => !byUid.has(uid)).sort(),
    unreadableWithoutUid,
  };
}

const uidOf = (component: InstanceType<typeof ICAL.Component>) =>
  String(component.getFirstPropertyValue("uid") ?? "").trim();

/** The nights an event blocks; "free" for one that blocks none, "unreadable". */
function blockedNights(
  component: InstanceType<typeof ICAL.Component>,
  timezone: string,
): FeedEvent | "free" | "unreadable" {
  const status = String(component.getFirstPropertyValue("status") ?? "").toUpperCase();
  const transparency = String(component.getFirstPropertyValue("transp") ?? "").toUpperCase();
  if (status === "CANCELLED" || transparency === "TRANSPARENT") return "free";

  const uid = uidOf(component);
  if (!uid || !component.hasProperty("dtstart")) return "unreadable";

  let event: InstanceType<typeof ICAL.Event>;
  try {
    event = new ICAL.Event(component);
  } catch {
    return "unreadable";
  }
  const start = event.startDate;
  const hasEnd = component.hasProperty("dtend") || component.hasProperty("duration");

  if (start.isDate) {
    const first = start.toString().slice(0, 10);
    // No end on a date event means one day (RFC 5545, 3.6.1).
    const end = hasEnd ? event.endDate.toString().slice(0, 10) : addDays(first, 1);
    if (!isCalendarDate(first) || !isCalendarDate(end)) return "unreadable";
    return end > first ? { uid, start: first, end } : { uid, start: first, end: addDays(first, 1) };
  }

  const first = localDate(start.toJSDate(), timezone);
  const endDay = hasEnd ? localDate(event.endDate.toJSDate(), timezone) : first;
  return { uid, start: first, end: endDay > first ? endDay : addDays(first, 1) };
}
