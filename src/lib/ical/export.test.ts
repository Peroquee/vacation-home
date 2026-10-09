import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import { buildFeed } from "./export";
import { parseFeed } from "./parse";

const now = new Date("2026-10-09T12:00:00Z");
const entries = [
  { kind: "booking" as const, id: "b1", start: "2026-10-14", end: "2026-10-18" },
  { kind: "block" as const, id: "k1", start: "2026-10-20", end: "2026-10-22" },
  // Ended more than 30 days before today: left out.
  { kind: "booking" as const, id: "old", start: "2026-08-01", end: "2026-08-05" },
];

describe("buildFeed", () => {
  const feed = buildFeed({ propertyName: "Seaside, Cottage", entries, today: "2026-10-09", now });

  it("is valid iCalendar that an iCal parser reads back", () => {
    const calendar = new ICAL.Component(ICAL.parse(feed));
    expect(calendar.name).toBe("vcalendar");
    expect(calendar.getFirstPropertyValue("version")).toBe("2.0");
    const events = calendar.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
    expect(events.map((e) => [e.startDate.toString(), e.endDate.toString()])).toEqual([
      ["2026-10-14", "2026-10-18"],
      ["2026-10-20", "2026-10-22"],
    ]);
    expect(events[0]!.uid).toMatch(/^[0-9a-f]{32}@vacation-home$/);
    // The same entry keeps its UID from one build to the next.
    expect(buildFeed({ propertyName: "x", entries, today: "2026-10-09" })).toContain(
      `UID:${events[0]!.uid}`,
    );
    // An X- property keeps its escaping in ical.js; the text is still there.
    expect(feed).toContain("X-WR-CALNAME:Seaside\\, Cottage");
  });

  it("round-trips through the app's own import", () => {
    expect(parseFeed(feed, "Europe/Berlin").map(({ start, end }) => [start, end])).toEqual([
      ["2026-10-14", "2026-10-18"],
      ["2026-10-20", "2026-10-22"],
    ]);
  });

  it("uses CRLF line ends and says only Booked or Blocked", () => {
    expect(feed.split("\r\n").every((line) => !line.includes("\n"))).toBe(true);
    expect(feed.match(/SUMMARY:.*/g)).toEqual(["SUMMARY:Booked", "SUMMARY:Blocked"]);
    expect(feed).not.toMatch(/DESCRIPTION|b1@|ATTENDEE/);
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const long = buildFeed({
      propertyName: "Ferienhaus ".repeat(12) + "Müller",
      entries: [],
      today: "2026-10-09",
      now,
    });
    for (const line of long.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const calendar = new ICAL.Component(ICAL.parse(long));
    expect(calendar.getFirstPropertyValue("x-wr-calname")).toBe(
      "Ferienhaus ".repeat(12) + "Müller",
    );
  });
});
