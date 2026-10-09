/**
 * The property's outbound iCal feed (GitLab #99): its taken dates, for the
 * booking platforms to import, so a stay booked here closes the dates there.
 * Pure; the route (src/app/api/ical/[token]) loads the data.
 *
 * - **What is in it**: confirmed bookings and every block (manual, Google,
 *   and other platforms' stays, so the platforms learn of each other), as
 *   whole-day events from check-in to check-out, end exclusive. Inquiries
 *   and cancelled bookings hold no dates, so they are not in it. Stays that
 *   ended over 30 days ago are left out.
 * - **No personal data**: an event says "Booked" or "Blocked", nothing
 *   else. No guest name, booking id or amount: the feed URL is the only
 *   secret, and platforms pass it around.
 * - **Stable UIDs** per booking and block, so a platform moves an event
 *   instead of adding a second one. They are hashes, so the feed shows no
 *   ids of the app.
 */
import { createHash } from "node:crypto";

import { addDays, type CalendarDate } from "@/lib/calendar-date";
import type { DateRange } from "@/lib/date-range";

export const FEED_HISTORY_DAYS = 30;

export type FeedEntry = DateRange & { kind: "booking" | "block"; id: string };

const uid = (entry: FeedEntry) =>
  createHash("sha256").update(`${entry.kind}:${entry.id}`).digest("hex").slice(0, 32);

/** "20260714" from "2026-07-14". */
const icsDate = (date: CalendarDate) => date.replaceAll("-", "");

/** "20261009T120000Z". */
const icsStamp = (instant: Date) =>
  instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Escapes TEXT values (RFC 5545, 3.3.11). */
const text = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets, continuing with a space (RFC 5545, 3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a UTF-8 character: back off continuation bytes.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // the leading space of a continuation counts
  }
  return parts.join("\r\n ");
}

export function buildFeed({
  propertyName,
  entries,
  today,
  now = new Date(),
}: {
  propertyName: string;
  entries: FeedEntry[];
  /** The property's local date, to leave out old stays. */
  today: CalendarDate;
  now?: Date;
}): string {
  const oldest = addDays(today, -FEED_HISTORY_DAYS);
  const stamp = icsStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vacation Home//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(propertyName)}`,
  ];
  const current = entries
    .filter((e) => e.end > oldest)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  for (const entry of current) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid(entry)}@vacation-home`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(entry.start)}`,
      `DTEND;VALUE=DATE:${icsDate(entry.end)}`,
      `SUMMARY:${entry.kind === "booking" ? "Booked" : "Blocked"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
