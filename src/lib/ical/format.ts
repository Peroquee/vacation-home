/**
 * Writing iCalendar (RFC 5545): the value encodings and line folding the
 * platform feed (GitLab #99) and the guest's calendar entry (#125) share.
 * Pure.
 */
import type { CalendarDate } from "@/lib/calendar-date";

/** "20260714" from "2026-07-14". */
export const icsDate = (date: CalendarDate) => date.replaceAll("-", "");

/** "20261009T120000Z". */
export const icsStamp = (instant: Date) =>
  instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Escapes TEXT values (RFC 5545, 3.3.11). */
export const icsText = (value: string) =>
  value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets, continuing with a space (RFC 5545, 3.1). */
export function fold(line: string): string {
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

/** The calendar as a file: folded lines, CRLF-terminated. */
export const icsFile = (lines: string[]) => lines.map(fold).join("\r\n") + "\r\n";
