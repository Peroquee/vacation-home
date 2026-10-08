/**
 * The round trip against a real PostgreSQL and one in-memory Google
 * Calendar: bookings pushed by outbound sync, events listed back by inbound
 * polling and imported as blocks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAvailability } from "@/lib/availability/service";
import { createBooking } from "@/lib/bookings/service";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { saveConnection } from "./connection";
import { pollDueWatches } from "./inbound";
import { importInboundEvents } from "./inbound-import";
import { CALENDAR_SCOPE } from "./oauth";
import { processDueLinks } from "./outbound";
import { fakeInboundCalendar } from "./testing/fake-calendar";

const CALENDAR = "lake@group.calendar.google.com";
let google: ReturnType<typeof fakeInboundCalendar>;
let propertyId: string;
let clock: Date;

const push = () => processDueLinks({ calendarFor: () => google.calendar });
const poll = () => {
  clock = new Date(clock.getTime() + 301_000);
  return pollDueWatches({ now: () => clock, calendarFor: () => google.calendar });
};
const googleBlocks = () =>
  db.block.findMany({ where: { propertyId, origin: "google" }, orderBy: { startDate: "asc" } });
const dates = async () =>
  (await googleBlocks()).map((b) => [
    b.externalEventId,
    b.startDate.toISOString().slice(0, 10),
    b.endDate.toISOString().slice(0, 10),
  ]);

beforeEach(async () => {
  google = fakeInboundCalendar();
  clock = new Date();
  const userId = (await db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` } }))
    .id;
  await saveConnection(userId, {
    googleAccountId: "g-1",
    googleEmail: null,
    scope: CALENDAR_SCOPE,
    refreshToken: "refresh",
    accessToken: "access",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "Europe/Lisbon", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  await db.propertyCalendar.create({
    data: {
      propertyId,
      userId,
      calendarId: CALENDAR,
      calendarName: "Family",
      outbound: true,
      inbound: true,
    },
  });
  // Start from an empty calendar.
  google.events.clear();
});

afterAll(() => db.$disconnect());

describe("importing", () => {
  it("does not turn the app's own bookings into blocks on the return trip", async () => {
    const guest = await db.guest.create({ data: { name: "Ada" } });
    const result = await createBooking({
      propertyId,
      guestId: guest.id,
      checkIn: "2026-12-01",
      checkOut: "2026-12-04",
      status: "confirmed",
      source: "direct",
      guestCount: 2,
    });
    expect("booking" in result).toBe(true);
    await push();
    expect(google.events.size).toBe(1);
    await poll();
    await poll();
    expect(await googleBlocks()).toEqual([]);
  });

  it("imports other events as read-only blocks, and follows their changes and deletion", async () => {
    google.put({
      id: "visit",
      summary: "Visit from Anna Example",
      start: { date: "2026-12-10" },
      end: { date: "2026-12-13" },
    });
    await poll();
    const [block] = await googleBlocks();
    expect(block).toMatchObject({
      origin: "google",
      externalEventId: "visit",
      reason: "Google Calendar · Family",
    });
    // The event's title, which may name people, is not stored.
    expect(JSON.stringify(block)).not.toContain("Anna");
    expect(
      (await getAvailability(propertyId, "2026-12-10", "2026-12-13")).map((d) => d.status),
    ).toEqual(["blocked", "blocked", "blocked"]);

    google.put({ ...google.events.get("visit")!, end: { date: "2026-12-15" } });
    await poll();
    expect(await dates()).toEqual([["visit", "2026-12-10", "2026-12-15"]]);

    // Deleting the source event in Google removes the block.
    google.remove("visit");
    await poll();
    expect(await googleBlocks()).toEqual([]);
  });

  it("leaves out meetings and free time, and drops a block whose event stops qualifying", async () => {
    google.put({
      id: "meeting",
      start: { dateTime: "2026-12-10T09:00:00Z" },
      end: { dateTime: "2026-12-10T10:00:00Z" },
    });
    google.put({ id: "free", transparency: "transparent" });
    google.put({
      id: "trip",
      start: { dateTime: "2026-12-20T15:00:00Z" },
      end: { dateTime: "2026-12-22T11:00:00Z" },
    });
    await poll();
    expect(await dates()).toEqual([["trip", "2026-12-20", "2026-12-22"]]);

    google.put({ ...google.events.get("trip")!, transparency: "transparent" });
    await poll();
    expect(await googleBlocks()).toEqual([]);
  });

  it("reconciles a full list: blocks of events no longer there go", async () => {
    await db.block.create({
      data: {
        propertyId,
        origin: "google",
        externalEventId: "long-gone",
        startDate: toUtcDate("2026-11-01"),
        endDate: toUtcDate("2026-11-02"),
      },
    });
    google.put({ id: "still-here" });
    // A fresh watch starts with a full list.
    await poll();
    expect((await dates()).map(([id]) => id)).toEqual(["still-here"]);
  });

  it("does not import an event over a confirmed booking, and imports the rest", async () => {
    const guest = await db.guest.create({ data: { name: "Ada" } });
    await createBooking({
      propertyId,
      guestId: guest.id,
      checkIn: "2026-12-01",
      checkOut: "2026-12-04",
      status: "confirmed",
      source: "direct",
      guestCount: 1,
    });
    const result = await importInboundEvents({
      propertyId,
      calendarId: CALENDAR,
      full: false,
      events: [
        {
          id: "clash",
          etag: "",
          status: "confirmed",
          updated: "",
          start: { date: "2026-12-03" },
          end: { date: "2026-12-05" },
        },
        {
          id: "fine",
          etag: "",
          status: "confirmed",
          updated: "",
          start: { date: "2026-12-04" },
          end: { date: "2026-12-06" },
        },
      ],
    });
    expect(result).toEqual({ created: 1, updated: 0, deleted: 0, conflicts: ["clash"] });
    expect((await dates()).map(([id]) => id)).toEqual(["fine"]);
  });

  it("never touches manual blocks", async () => {
    await db.block.create({
      data: {
        propertyId,
        startDate: toUtcDate("2026-12-01"),
        endDate: toUtcDate("2026-12-02"),
        reason: "Painting",
      },
    });
    await poll();
    expect(await db.block.count({ where: { origin: "manual" } })).toBe(1);
  });
});
