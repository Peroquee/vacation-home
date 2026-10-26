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
 * - **Times** (GitLab #142): one in UTC is that instant; one with a TZID is
 *   read in that zone, an IANA name through Intl, any other by the feed's
 *   own VTIMEZONE for it; a floating one, or a TZID nothing defines, is the
 *   property's wall clock. Never the server's timezone, and no definition
 *   is shared between feeds: ical.js's process-wide TimezoneService is not
 *   used.
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

import { zonedInstant } from "./stay-event";

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

  // The feed's own timezone definitions, for TZIDs that are not IANA names
  // (e.g. Windows ones). Kept to this feed: never registered process-wide.
  const zones = new Map<string, InstanceType<typeof ICAL.Timezone>>();
  for (const zone of calendar.getAllSubcomponents("vtimezone")) {
    const tzid = zone.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !isIanaZone(tzid)) {
      zones.set(tzid, new ICAL.Timezone(zone));
    }
  }

  const byUid = new Map<string, FeedEvent>();
  const unreadable = new Set<string>();
  let unreadableWithoutUid = 0;
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const nights = blockedNights(component, timezone, zones);
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
  zones: Map<string, InstanceType<typeof ICAL.Timezone>>,
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

  const startZone = tzidOf(component, "dtstart");
  const first = localDay(start, startZone, timezone, zones);
  // An end given as a duration is in the start's zone.
  const endZone = component.hasProperty("dtend") ? tzidOf(component, "dtend") : startZone;
  const endDay = hasEnd ? localDay(event.endDate, endZone, timezone, zones) : first;
  if (!isCalendarDate(first) || !isCalendarDate(endDay)) return "unreadable";
  return { uid, start: first, end: endDay > first ? endDay : addDays(first, 1) };
}

const tzidOf = (component: InstanceType<typeof ICAL.Component>, name: string) => {
  const tzid = component.getFirstProperty(name)?.getParameter("tzid");
  return typeof tzid === "string" && tzid.trim() ? tzid.trim() : null;
};

/** Whether Intl knows `name` as a timezone, e.g. "Europe/Berlin" or "UTC". */
function isIanaZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * The date in the property's `timezone` of an iCal time: a date as it is,
 * a time by the rules in the module comment. Only the value's own fields
 * are read, never through the server's local time.
 */
function localDay(
  time: InstanceType<typeof ICAL.Time>,
  tzid: string | null,
  timezone: string,
  zones: Map<string, InstanceType<typeof ICAL.Timezone>>,
): CalendarDate {
  const date = `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  if (time.isDate) return date;
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const clock = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  let instant: Date;
  if (time.zone === ICAL.Timezone.utcTimezone || tzid === "UTC" || tzid === "Z") {
    instant = new Date(wall);
  } else if (tzid && isIanaZone(tzid)) {
    instant = new Date(zonedInstant(date, clock, tzid).getTime() + time.second * 1000);
  } else if (tzid && zones.has(tzid)) {
    instant = new Date(wall - zones.get(tzid)!.utcOffset(time) * 1000);
  } else {
    instant = new Date(zonedInstant(date, clock, timezone).getTime() + time.second * 1000);
  }
  return localDate(instant, timezone);
}
