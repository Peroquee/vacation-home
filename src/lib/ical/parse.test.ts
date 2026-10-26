import { describe, expect, it } from "vitest";

import { FeedParseError, parseFeed, readFeed } from "./parse";

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

// GitLab #144: an event it can't read must never look like a cancelled one.
describe("readFeed", () => {
  const feed = ics(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:fine@airbnb.com",
    "DTSTART;VALUE=DATE:20261102",
    "DTEND;VALUE=DATE:20261105",
    "END:VEVENT",
    // Cancelled on the platform: not unreadable, simply not blocking.
    "BEGIN:VEVENT",
    "UID:cancelled@airbnb.com",
    "STATUS:CANCELLED",
    "DTSTART;VALUE=DATE:20261110",
    "DTEND;VALUE=DATE:20261112",
    "END:VEVENT",
    // No start: a stay we can't read.
    "BEGIN:VEVENT",
    "UID:broken@airbnb.com",
    "SUMMARY:Reserved",
    "END:VEVENT",
    // No UID: can't be told apart from any other stay.
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261120",
    "DTEND;VALUE=DATE:20261122",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  it("names the events it couldn't read, apart from the cancelled ones", () => {
    expect(readFeed(feed, "UTC")).toEqual({
      events: [{ uid: "fine@airbnb.com", start: "2026-11-02", end: "2026-11-05" }],
      unreadable: ["broken@airbnb.com"],
      unreadableWithoutUid: 1,
    });
  });

  it("counts as read any UID that also has an event it could read", () => {
    const twice = ics(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:same@airbnb.com",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:same@airbnb.com",
      "DTSTART;VALUE=DATE:20261102",
      "DTEND;VALUE=DATE:20261105",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    expect(readFeed(twice, "UTC")).toMatchObject({ unreadable: [], unreadableWithoutUid: 0 });
  });
});

describe("times without a timezone of their own (GitLab #142)", () => {
  // Late evenings, where reading them in the wrong zone moves the date.
  const feed = ics(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTIMEZONE",
    "TZID:W. Europe Standard Time",
    "BEGIN:STANDARD",
    "DTSTART:16010101T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:16010101T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:floating",
    "DTSTART:20261024T230000",
    "DTEND:20261026T100000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:tzid-without-vtimezone",
    "DTSTART;TZID=Europe/Berlin:20261024T230000",
    "DTEND;TZID=Europe/Berlin:20261026T100000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:new-york",
    // 20:00 in New York is 02:00 the next day in Berlin.
    "DTSTART;TZID=America/New_York:20261024T200000",
    "DTEND;TZID=America/New_York:20261026T080000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:windows-zone",
    "DTSTART;TZID=W. Europe Standard Time:20261024T233000",
    "DTEND;TZID=W. Europe Standard Time:20261026T100000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:date-end",
    "DTSTART;TZID=Europe/Berlin:20261024T230000",
    "DTEND;VALUE=DATE:20261027",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  const expected = [
    { uid: "floating", start: "2026-10-24", end: "2026-10-26" },
    { uid: "tzid-without-vtimezone", start: "2026-10-24", end: "2026-10-26" },
    { uid: "new-york", start: "2026-10-25", end: "2026-10-26" },
    { uid: "windows-zone", start: "2026-10-24", end: "2026-10-26" },
    { uid: "date-end", start: "2026-10-24", end: "2026-10-27" },
  ];

  // The lint rule is about the app's configuration; this sets the process
  // timezone the way production (UTC) and the database suite (UTC+14) run.
  // eslint-disable-next-line no-restricted-properties
  const env = process.env;

  it.each(["UTC", "Pacific/Kiritimati", "America/Los_Angeles"])(
    "reads them in the property's timezone, or their named one, whatever the server's (%s)",
    (zone) => {
      const before = env.TZ;
      env.TZ = zone;
      try {
        expect(parseFeed(feed, "Europe/Berlin")).toEqual(expected);
      } finally {
        if (before === undefined) delete env.TZ;
        else env.TZ = before;
      }
    },
  );

  it("does not let one feed's timezone definition change how another is read", () => {
    // A feed that defines Europe/Berlin wrongly (UTC+5)...
    parseFeed(
      ics(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Berlin",
        "BEGIN:STANDARD",
        "DTSTART:16010101T000000",
        "TZOFFSETFROM:+0500",
        "TZOFFSETTO:+0500",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:x",
        "DTSTART;TZID=Europe/Berlin:20261001T120000",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      "Europe/Berlin",
    );
    // ...then one that relies on the real Europe/Berlin.
    expect(parseFeed(feed, "Europe/Berlin")).toEqual(expected);
  });
});
