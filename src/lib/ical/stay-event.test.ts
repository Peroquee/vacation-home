/**
 * The guest's calendar entry (GitLab #125), read back with a real parser
 * (ical.js): one valid event, at the right time in the property's
 * timezone, with a UID that stays the same for the booking.
 */
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";

import { icsText } from "./format";
import {
  googleCalendarLink,
  outlookCalendarLink,
  type StayEvent,
  stayCalendar,
  stayEventWords,
  stayUid,
  zonedInstant,
} from "./stay-event";

const EVENT: StayEvent = {
  bookingId: "8d3c3d4e-58a4-4c8a-9a52-0d6f4f1d2b11",
  status: "confirmed",
  checkIn: "2026-09-10",
  checkOut: "2026-09-14",
  // Arrival from 15:00, departure between 10:00 and 11:00.
  times: { checkInTime: "15:00", earliestCheckOutTime: "10:00", checkOutTime: "11:00" },
  timezone: "Europe/Berlin",
  version: new Date("2026-08-01T09:30:00Z"),
  summary: "Stay: Dorum 1",
  description: "Reference: AB12-CD34\nYour booking: https://example.test/stay/booking/tok",
  location: "Dorum, Lower Saxony",
  guestUrl: "https://example.test/stay/booking/tok",
};
const NOW = new Date("2026-08-02T12:00:00Z");

function parse(ics: string) {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  const events = calendar.getAllSubcomponents("vevent");
  expect(events).toHaveLength(1);
  return { calendar, vevent: events[0]!, event: new ICAL.Event(events[0]!) };
}

describe("the .ics file", () => {
  it("is one valid event, from the earliest arrival to the latest departure, in the property's timezone", () => {
    const ics = stayCalendar(EVENT, NOW);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    const { calendar, event, vevent } = parse(ics);
    expect(calendar.getFirstPropertyValue("version")).toBe("2.0");
    expect(calendar.getFirstPropertyValue("method")).toBe("PUBLISH");
    // 15:00 and 11:00 in Berlin's summer time: the latest departure, not the earliest.
    expect(event.startDate.toJSDate().toISOString()).toBe("2026-09-10T13:00:00.000Z");
    expect(event.endDate.toJSDate().toISOString()).toBe("2026-09-14T09:00:00.000Z");
    expect(event.startDate.zone.tzid).toBe("UTC");
    expect(event.summary).toBe("Stay: Dorum 1");
    expect(event.location).toBe("Dorum, Lower Saxony");
    expect(event.description).toBe(EVENT.description);
    expect(vevent.getFirstPropertyValue("url")).toBe(EVENT.guestUrl);
    expect(vevent.getFirstPropertyValue("status")).toBe("CONFIRMED");
  });

  it("follows the property's timezone through a change of the clocks", () => {
    // Arriving in summer time, leaving in winter time (25 October 2026).
    const { event } = parse(
      stayCalendar({ ...EVENT, checkIn: "2026-10-20", checkOut: "2026-10-27" }, NOW),
    );
    expect(event.startDate.toJSDate().toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(event.endDate.toJSDate().toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(zonedInstant("2026-01-15", "15:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T20:00:00.000Z",
    );
  });

  it("is whole days, the departure day included, without both times", () => {
    for (const times of [
      { checkInTime: null, earliestCheckOutTime: null, checkOutTime: null },
      { checkInTime: "15:00", earliestCheckOutTime: "10:00", checkOutTime: null },
      { checkInTime: null, earliestCheckOutTime: "10:00", checkOutTime: "11:00" },
    ]) {
      const { event } = parse(stayCalendar({ ...EVENT, times }, NOW));
      expect(event.startDate.isDate).toBe(true);
      expect(event.startDate.toString()).toBe("2026-09-10");
      expect(event.endDate.toString()).toBe("2026-09-15");
    }
  });

  it("keeps one UID per booking, and a SEQUENCE that grows with each version", () => {
    const first = parse(stayCalendar(EVENT, NOW)).vevent;
    // The fully-paid email's, a second after the deposit email's.
    const later = parse(
      stayCalendar({ ...EVENT, version: new Date("2026-08-01T09:30:01Z") }, NOW),
    ).vevent;
    expect(first.getFirstPropertyValue("uid")).toBe(stayUid(EVENT.bookingId));
    expect(later.getFirstPropertyValue("uid")).toBe(first.getFirstPropertyValue("uid"));
    expect(Number(later.getFirstPropertyValue("sequence"))).toBeGreaterThan(
      Number(first.getFirstPropertyValue("sequence")),
    );
    // Both confirmations of one payment, in the same second: the final one wins.
    const sameSecond = parse(stayCalendar({ ...EVENT, final: true }, NOW)).vevent;
    expect(Number(sameSecond.getFirstPropertyValue("sequence"))).toBeGreaterThan(
      Number(first.getFirstPropertyValue("sequence")),
    );
    expect(Number(later.getFirstPropertyValue("sequence"))).toBeGreaterThan(
      Number(sameSecond.getFirstPropertyValue("sequence")),
    );
    expect(stayUid("another")).not.toBe(stayUid(EVENT.bookingId));
    // A hash: no id of the app in it.
    expect(stayUid(EVENT.bookingId)).not.toContain(EVENT.bookingId.slice(0, 8));
  });

  it("marks a stay that no longer holds its dates as cancelled, a reservation as tentative", () => {
    const status = (s: StayEvent["status"]) =>
      parse(stayCalendar({ ...EVENT, status: s }, NOW)).vevent.getFirstPropertyValue("status");
    expect(status("cancelled")).toBe("CANCELLED");
    expect(status("expired")).toBe("CANCELLED");
    expect(status("reserved")).toBe("TENTATIVE");
    expect(status("paid")).toBe("CONFIRMED");
  });

  it("escapes text, and folds long lines without splitting a character", () => {
    const tricky = "Haus; am Deich, \\ Süd\nZimmer 2 ".padEnd(200, "ä");
    const { event } = parse(
      stayCalendar({ ...EVENT, summary: tricky, location: "Weg 1; 27632 Dorum" }, NOW),
    );
    expect(event.summary).toBe(tricky);
    expect(event.location).toBe("Weg 1; 27632 Dorum");
    expect(icsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("leaves the location out when there is none", () => {
    expect(stayCalendar({ ...EVENT, location: "" }, NOW)).not.toContain("LOCATION");
  });
});

describe("the quick links", () => {
  it("give Google Calendar the same event", () => {
    const url = new URL(googleCalendarLink(EVENT));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: EVENT.summary,
      dates: "20260910T130000Z/20260914T090000Z",
      details: EVENT.description,
      location: EVENT.location,
    });
    const allDay = new URL(
      googleCalendarLink({ ...EVENT, times: { ...EVENT.times, checkInTime: null } }),
    );
    expect(allDay.searchParams.get("dates")).toBe("20260910/20260915");
  });

  it("give Outlook.com the same event", () => {
    const url = new URL(outlookCalendarLink(EVENT));
    expect(url.origin + url.pathname).toBe("https://outlook.live.com/calendar/0/action/compose");
    expect(url.searchParams.get("subject")).toBe(EVENT.summary);
    expect(url.searchParams.get("startdt")).toBe("2026-09-10T13:00:00Z");
    expect(url.searchParams.get("enddt")).toBe("2026-09-14T09:00:00Z");
    expect(url.searchParams.get("allday")).toBe("false");
    expect(url.searchParams.get("body")).toBe(EVENT.description);
    const allDay = new URL(
      outlookCalendarLink({ ...EVENT, times: { ...EVENT.times, checkOutTime: null } }),
    );
    expect(allDay.searchParams.get("startdt")).toBe("2026-09-10");
    expect(allDay.searchParams.get("enddt")).toBe("2026-09-15");
    expect(allDay.searchParams.get("allday")).toBe("true");
  });
});

describe("the words", () => {
  const t = (key: string, values?: Record<string, string>) => `${key}${JSON.stringify(values)}`;

  it("name the reference, the times and the guest's page, one per line", () => {
    const times = "Arrival from 15:00 · Departure between 10:00 and 11:00";
    expect(
      stayEventWords(t, {
        title: "Dorum 1",
        reference: "AB12CD34",
        times,
        guestUrl: "https://example.test/x",
      }),
    ).toEqual({
      summary: 'summary{"title":"Dorum 1"}',
      description: [
        'reference{"reference":"AB12-CD34"}',
        times,
        'link{"url":"https://example.test/x"}',
      ].join("\n"),
    });
    expect(
      stayEventWords(t, { title: "x", reference: null, times: null, guestUrl: "u" }).description,
    ).toBe('link{"url":"u"}');
  });
});
