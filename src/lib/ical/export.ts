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

import { icsDate, icsFile, icsStamp, icsText as text } from "./format";

export const FEED_HISTORY_DAYS = 30;

export type FeedEntry = DateRange & { kind: "booking" | "block"; id: string };

const uid = (entry: FeedEntry) =>
  createHash("sha256").update(`${entry.kind}:${entry.id}`).digest("hex").slice(0, 32);

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
  return icsFile(lines);
}
