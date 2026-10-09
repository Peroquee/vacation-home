import { describe, expect, it } from "vitest";

import { FeedParseError, parseFeed } from "./parse";

const ics = (...lines: string[]) => [...lines, ""].join("\r\n");

// The shape of an Airbnb host calendar export.
const AIRBNB = ics(
  "BEGIN:VCALENDAR",
  "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20260718",
  "DTSTART;VALUE=DATE:20260714",
  "UID:1418fb94e984-5a8f9b4ac1b9@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de",
  " tails/HMABCDEF\\nPhone Number (Last 4 Digits): 1234",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20260801",
  "DTSTART;VALUE=DATE:20260725",
  "UID:7f3c2d1e0a9b-8c7d6e5f4a3b@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
);

// The shape of a Booking.com availability export.
const BOOKING = ics(
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//admin.booking.com//EN",
  "BEGIN:VEVENT",
  "UID:20260810-1234567@booking.com",
  "DTSTAMP:20261009T120000Z",
  "DTSTART;VALUE=DATE:20260810",
  "DTEND;VALUE=DATE:20260813",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "END:VCALENDAR",
);

describe("parseFeed", () => {
  it("reads Airbnb's stays on their own dates, end exclusive", () => {
    expect(parseFeed(AIRBNB, "Europe/Berlin")).toEqual([
      { uid: "1418fb94e984-5a8f9b4ac1b9@airbnb.com", start: "2026-07-14", end: "2026-07-18" },
      { uid: "7f3c2d1e0a9b-8c7d6e5f4a3b@airbnb.com", start: "2026-07-25", end: "2026-08-01" },
    ]);
  });

  it("reads Booking.com's closed dates", () => {
    expect(parseFeed(BOOKING, "Europe/Berlin")).toEqual([
      { uid: "20260810-1234567@booking.com", start: "2026-08-10", end: "2026-08-13" },
    ]);
  });

  it("keeps nothing but the UID and the dates", () => {
    const text = JSON.stringify(parseFeed(AIRBNB, "Europe/Berlin"));
    expect(text).not.toMatch(/Reserved|HMABCDEF|1234|airbnb\.com\/hosting/);
  });

  it("leaves out cancelled and free events", () => {
    const feed = ics(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART;VALUE=DATE:20260901",
      "DTEND;VALUE=DATE:20260903",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "DTSTART;VALUE=DATE:20260901",
      "DTEND;VALUE=DATE:20260903",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(parseFeed(feed, "UTC")).toEqual([]);
  });

  it("gives a date event without an end one day, and a timed one every night it touches", () => {
    const feed = ics(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:day",
      "DTSTART;VALUE=DATE:20260901",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:timed",
      // 15:00 on the 4th to 10:00 on the 6th, Berlin time.
      "DTSTART:20260904T130000Z",
      "DTEND:20260906T080000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:short",
      "DTSTART:20260910T090000Z",
      "DTEND:20260910T100000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(parseFeed(feed, "Europe/Berlin")).toEqual([
      { uid: "day", start: "2026-09-01", end: "2026-09-02" },
      { uid: "timed", start: "2026-09-04", end: "2026-09-06" },
      { uid: "short", start: "2026-09-10", end: "2026-09-11" },
    ]);
  });

  it("keeps one event per UID", () => {
    const event = (end: string) => [
      "BEGIN:VEVENT",
      "UID:same",
      "DTSTART;VALUE=DATE:20261001",
      `DTEND;VALUE=DATE:${end}`,
      "END:VEVENT",
    ];
    const feed = ics(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      ...event("20261003"),
      ...event("20261005"),
      "END:VCALENDAR",
    );
    expect(parseFeed(feed, "UTC")).toEqual([
      { uid: "same", start: "2026-10-01", end: "2026-10-05" },
    ]);
  });

  it("refuses what is not iCalendar", () => {
    expect(() => parseFeed("<html>Sign in</html>", "UTC")).toThrow(FeedParseError);
    expect(() => parseFeed("", "UTC")).toThrow(FeedParseError);
  });
});
