/**
 * The guest's stay as a calendar entry (GitLab #125): an .ics file with one
 * event, and the same event as "add event" links for Google Calendar and
 * Outlook.com. Pure; the guest's download route and the emails load the
 * data and pass the words in the guest's language.
 *
 * - **When**: from the arrival day at the earliest arrival to the departure
 *   day at the latest departure (#126; the owner's decision, 2026-10-21),
 *   as the booking was reserved
 *   under, in the property's timezone (written as UTC, which RFC 5545
 *   allows without a VTIMEZONE; every calendar shows it in its own zone).
 *   Without both times: whole days, the departure day included.
 * - **What**: the property's public title, the reference, the arrival and
 *   departure times (the earliest departure too) and a link back to the
 *   guest's page; where: the approximate location, the exact address only
 *   in the fully-paid email (the caller decides). Nothing about other
 *   guests, nothing internal.
 * - **One UID per booking**, a hash that shows no id of the app, with a
 *   SEQUENCE that grows with each version: the fully-paid email's file
 *   updates the entry the deposit email's made instead of adding a second
 *   one. A cancelled stay is CANCELLED.
 */
import { createHash } from "node:crypto";

import type { BookingStatus } from "@/generated/prisma/client";
import { formatReference } from "@/lib/booking-requests/values";
import { addDays, type CalendarDate } from "@/lib/calendar-date";
import type { StayTimes } from "@/lib/listing/stay-times";

import { icsDate, icsFile, icsStamp, icsText } from "./format";

export type StayEvent = {
  bookingId: string;
  status: BookingStatus;
  checkIn: CalendarDate;
  checkOut: CalendarDate;
  /** The earliest arrival and the latest departure make it a timed event (#126). */
  times: StayTimes;
  timezone: string;
  /** When this version was written (the email's event, the booking's last change): its SEQUENCE. */
  version: Date;
  summary: string;
  description: string;
  /** Blank for none. */
  location: string;
  guestUrl: string;
};

type Timing =
  | { allDay: true; start: CalendarDate; end: CalendarDate }
  | { allDay: false; start: Date; end: Date };

/** The UTC offset of `timeZone` at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time on `date` is in `timeZone`. */
export function zonedInstant(date: CalendarDate, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, min);
  // Twice, for a date whose offset differs from the first guess's (DST).
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return new Date(instant);
}

function timing(event: StayEvent): Timing {
  const { checkInTime, checkOutTime } = event.times;
  if (checkInTime && checkOutTime) {
    const start = zonedInstant(event.checkIn, checkInTime, event.timezone);
    const end = zonedInstant(event.checkOut, checkOutTime, event.timezone);
    if (end > start) return { allDay: false, start, end };
  }
  // The end is exclusive: the departure day is in it.
  return { allDay: true, start: event.checkIn, end: addDays(event.checkOut, 1) };
}

const STATUS: Record<BookingStatus, "TENTATIVE" | "CONFIRMED" | "CANCELLED"> = {
  inquiry: "TENTATIVE",
  reserved: "TENTATIVE",
  confirmed: "CONFIRMED",
  paid: "CONFIRMED",
  expired: "CANCELLED",
  cancelled: "CANCELLED",
};

/** Seconds since 2026-01-01: growing with each version, and a 32-bit integer until 2094. */
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);
export const stayVersion = (version: Date) =>
  Math.max(0, Math.floor((version.getTime() - SEQUENCE_EPOCH) / 1000));

export const stayUid = (bookingId: string) =>
  `${createHash("sha256").update(`stay:${bookingId}`).digest("hex").slice(0, 32)}@vacation-home`;

/** The .ics file: one VEVENT. */
export function stayCalendar(event: StayEvent, now = new Date()): string {
  const when = timing(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vacation Home//Stay//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${stayUid(event.bookingId)}`,
    `DTSTAMP:${icsStamp(now)}`,
    `LAST-MODIFIED:${icsStamp(event.version)}`,
    `SEQUENCE:${stayVersion(event.version)}`,
    ...(when.allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(when.start)}`, `DTEND;VALUE=DATE:${icsDate(when.end)}`]
      : [`DTSTART:${icsStamp(when.start)}`, `DTEND:${icsStamp(when.end)}`]),
    `SUMMARY:${icsText(event.summary)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    `DESCRIPTION:${icsText(event.description)}`,
    `URL:${event.guestUrl}`,
    `STATUS:${STATUS[event.status]}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return icsFile(lines);
}

/** Google Calendar's "add event" page with the same event. */
export function googleCalendarLink(event: StayEvent): string {
  const when = timing(event);
  const dates = when.allDay
    ? `${icsDate(when.start)}/${icsDate(when.end)}`
    : `${icsStamp(when.start)}/${icsStamp(when.end)}`;
  const url = new URL("https://calendar.google.com/calendar/render");
  url.search = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates,
    details: event.description,
    ...(event.location && { location: event.location }),
  }).toString();
  return url.toString();
}

/** Outlook.com's "add event" page with the same event. */
export function outlookCalendarLink(event: StayEvent): string {
  const when = timing(event);
  const iso = (instant: Date) => instant.toISOString().replace(/\.\d{3}Z$/, "Z");
  const url = new URL("https://outlook.live.com/calendar/0/action/compose");
  url.search = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.summary,
    startdt: when.allDay ? when.start : iso(when.start),
    enddt: when.allDay ? when.end : iso(when.end),
    allday: String(when.allDay),
    body: event.description,
    ...(event.location && { location: event.location }),
  }).toString();
  return url.toString();
}

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * The event's words, from the `stayCalendar` messages: the title, and the
 * reference, the arrival and departure times (as describeStayTimes words
 * them, the earliest departure included) and the guest's link, one per line.
 */
export function stayEventWords(
  t: Translate,
  stay: { title: string; reference: string | null; times: string | null; guestUrl: string },
): { summary: string; description: string } {
  return {
    summary: t("summary", { title: stay.title }),
    description: [
      stay.reference && t("reference", { reference: formatReference(stay.reference) }),
      stay.times,
      t("link", { url: stay.guestUrl }),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** The download's path under the guest's page. */
export const stayCalendarPath = (guestPath: string) => `${guestPath}/calendar.ics`;
