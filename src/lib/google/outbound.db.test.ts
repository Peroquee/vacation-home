/**
 * Outbound sync end to end, against a real PostgreSQL and an in-memory
 * Google Calendar: bookings created, moved and cancelled through the
 * booking service, then pushed by the worker's processing step.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelBooking,
  createBooking,
  reinstateBooking,
  updateBooking,
} from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { type CalendarClient, type CalendarEvent, GoogleCalendarError } from "./calendar";
import { saveConnection } from "./connection";
import { CALENDAR_SCOPE } from "./oauth";
import { APP_EVENT_MARKER, bookingEvent, processDueLinks, scheduleProperty } from "./outbound";

const CALENDAR = "lake@group.calendar.google.com";

/** Google Calendar in memory: events by id, deleted ids remembered, failures on demand. */
function fakeGoogle() {
  const events = new Map<string, CalendarEvent>();
  const deleted = new Set<string>();
  const calls: string[] = [];
  const failures: GoogleCalendarError[] = [];
  let beforeWrite: (() => Promise<void>) | null = null;
  let version = 0;
  const step = async (name: string) => {
    calls.push(name);
    const failure = failures.shift();
    if (failure) throw failure;
    const hook = beforeWrite;
    beforeWrite = null;
    if (hook) await hook();
  };
  const write = (id: string, input: object): CalendarEvent => {
    const event = {
      ...(input as CalendarEvent),
      id,
      etag: `"${++version}"`,
      status: "confirmed" as const,
      updated: "",
    };
    events.set(id, event);
    return event;
  };
  const calendar = {
    async insertEvent(calendarId: string, input: { id?: string }) {
      await step("insert");
      if (calendarId !== CALENDAR) throw new GoogleCalendarError("not_found", 404, "notFound", 1);
      if (events.has(input.id!) || deleted.has(input.id!)) {
        throw new GoogleCalendarError("conflict", 409, "duplicate", 1);
      }
      return write(input.id!, input);
    },
    async updateEvent(_calendarId: string, eventId: string, input: object) {
      await step("update");
      if (!events.has(eventId)) throw new GoogleCalendarError("not_found", 404, "notFound", 1);
      return write(eventId, input);
    },
    async deleteEvent(_calendarId: string, eventId: string) {
      await step("delete");
      if (!events.delete(eventId)) return "already_gone" as const;
      deleted.add(eventId);
      return "deleted" as const;
    },
  } as unknown as CalendarClient;
  return {
    calendar,
    events,
    calls,
    failNext: (...errors: GoogleCalendarError[]) => failures.push(...errors),
    /** Runs `hook` inside the next write, after Google has accepted it. */
    duringNextWrite: (hook: () => Promise<void>) => (beforeWrite = hook),
    /** What the user does by deleting the event in Google. */
    deleteInGoogle: (id: string) => {
      events.delete(id);
      deleted.add(id);
    },
  };
}

let google: ReturnType<typeof fakeGoogle>;
let userId: string;
let propertyId: string;
let guestId: string;
/** The worker's clock: real time unless a test moves it. */
let clock: Date | null;

const sync = () =>
  processDueLinks({ calendarFor: () => google.calendar, now: () => clock ?? new Date() });
const onlyEvent = () => {
  expect(google.events.size).toBe(1);
  return [...google.events.values()][0];
};

async function book(
  checkIn: string,
  checkOut: string,
  status: "confirmed" | "inquiry" = "confirmed",
) {
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn,
    checkOut,
    status,
    source: "direct",
    guestCount: 2,
    nightlyRateMinor: 10_000,
    cleaningFeeMinor: 5_000,
    notes: "Allergic to cats",
  });
  if (!("booking" in result)) throw new Error(`booking failed: ${JSON.stringify(result)}`);
  return result.booking;
}

beforeEach(async () => {
  google = fakeGoogle();
  clock = null;
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  await db.googleConnection.deleteMany();
  await db.user.deleteMany({ where: { email: "sync@example.test" } });
  userId = (await db.user.create({ data: { email: "sync@example.test" } })).id;
  await saveConnection(userId, {
    googleAccountId: "g-1",
    googleEmail: "sync@example.test",
    scope: CALENDAR_SCOPE,
    refreshToken: "refresh",
    accessToken: "access",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  await db.propertyCalendar.create({
    data: { propertyId, userId, calendarId: CALENDAR, calendarName: "Lake" },
  });
  guestId = (
    await db.guest.create({
      data: { name: "Ada Lovelace", email: "ada@example.test", phone: "+44 20 7946 0000" },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("the event", () => {
  it("is an all-day event for the stay, without any guest personal data", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    expect(await sync()).toEqual({ pushed: 1, deleted: 0, failed: 0, deferred: 0 });

    const event = onlyEvent();
    expect(event).toMatchObject({
      summary: "Booking · Lake house",
      start: { date: "2026-11-01" },
      end: { date: "2026-11-04" },
      extendedProperties: { private: { [APP_EVENT_MARKER]: "booking", bookingId: booking.id } },
    });
    expect(event.description).toContain(`Booking ${booking.id}`);
    expect(event.description).toContain("3 nights, 2 guests");
    expect(event.description).toMatch(/Total: €350\.00/);
    const text = JSON.stringify(event);
    for (const personal of ["Ada", "Lovelace", "ada@example.test", "7946", "cats"]) {
      expect(text).not.toContain(personal);
    }
  });

  it("is built the same way for any booking", () => {
    const event = bookingEvent(
      {
        id: "b1",
        checkIn: "2026-11-01",
        checkOut: "2026-11-02",
        guestCount: 1,
        totalAmountMinor: 0,
        currency: "EUR",
      },
      { name: "Sea cottage" },
    );
    expect(event.summary).toBe("Booking · Sea cottage");
    expect(event.description).toContain("1 night, 1 guest");
  });
});

describe("keeping Google in step", () => {
  it("updates the same event when the booking changes, never adding another", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await sync();
    const id = onlyEvent().id;

    await updateBooking(booking.id, { checkOut: "2026-11-06" });
    await sync();
    expect(onlyEvent()).toMatchObject({ id, end: { date: "2026-11-06" } });
    expect(google.calls).toEqual(["insert", "update"]);
  });

  it("collapses rapid edits into one push of the latest version", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await updateBooking(booking.id, { checkOut: "2026-11-05" });
    await updateBooking(booking.id, { checkOut: "2026-11-07" });
    await sync();
    expect(google.calls).toEqual(["insert"]);
    expect(onlyEvent().end).toEqual({ date: "2026-11-07" });
  });

  it("pushes again when the booking changed while its push was under way", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    google.duringNextWrite(async () => {
      await updateBooking(booking.id, { checkOut: "2026-11-09" });
    });
    // The second pass of the same run picks up the newer change.
    await sync();
    expect(google.calls).toEqual(["insert", "update"]);
    expect(onlyEvent().end).toEqual({ date: "2026-11-09" });
    expect(await db.calendarEventLink.findFirstOrThrow()).toMatchObject({ syncState: "synced" });
  });

  it("deletes the event when the booking is cancelled", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await sync();
    await cancelBooking(booking.id);
    expect(await sync()).toMatchObject({ deleted: 1 });
    expect(google.events.size).toBe(0);
    expect(await db.calendarEventLink.count()).toBe(0);
    // Cancelling twice schedules nothing more.
    await cancelBooking(booking.id);
    expect(await sync()).toEqual({ pushed: 0, deleted: 0, failed: 0, deferred: 0 });
  });

  it("gives inquiries no event until confirmed", async () => {
    const booking = await book("2026-11-01", "2026-11-04", "inquiry");
    await sync();
    expect(google.calls).toEqual([]);
    await updateBooking(booking.id, { status: "confirmed" });
    await sync();
    expect(onlyEvent().start).toEqual({ date: "2026-11-01" });
  });

  it("re-creates an event the user deleted in Google", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await sync();
    google.deleteInGoogle(onlyEvent().id);
    await updateBooking(booking.id, { guestCount: 3 });
    await sync();
    expect(onlyEvent().description).toContain("3 guests");
    expect(google.calls).toEqual(["insert", "update", "insert"]);
  });

  it("re-confirming a booking whose delete is still pending gives it a new event", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await sync();
    await cancelBooking(booking.id);
    google.duringNextWrite(async () => {
      await reinstateBooking(booking.id);
      await updateBooking(booking.id, { status: "confirmed" });
    });
    await sync();
    expect(onlyEvent().start).toEqual({ date: "2026-11-01" });
    expect(await db.calendarEventLink.count()).toBe(1);
  });
});

describe("when Google fails", () => {
  it("records the failure, backs off, and succeeds later without duplicating", async () => {
    await book("2026-11-01", "2026-11-04");
    google.failNext(new GoogleCalendarError("rate_limited", 429, null, 5));
    expect(await sync()).toMatchObject({ failed: 1, pushed: 0 });
    const failed = await db.calendarEventLink.findFirstOrThrow();
    expect(failed).toMatchObject({ syncState: "failed", lastError: "rate_limited", attempts: 1 });
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Not retried before the backoff has passed.
    expect(await sync()).toMatchObject({ pushed: 0, failed: 0 });
    clock = new Date(failed.nextAttemptAt.getTime() + 1);
    expect(await sync()).toMatchObject({ pushed: 1 });
    expect(google.events.size).toBe(1);
    expect(await db.calendarEventLink.findFirstOrThrow()).toMatchObject({
      syncState: "synced",
      attempts: 0,
      lastError: null,
    });
  });

  it("keeps going with the other bookings", async () => {
    await book("2026-11-01", "2026-11-04");
    await book("2026-11-10", "2026-11-12");
    google.failNext(new GoogleCalendarError("server_error", 503, null, 5));
    expect(await sync()).toMatchObject({ pushed: 1, failed: 1 });
  });

  it("waits, without calling Google, while the account is disconnected", async () => {
    await db.googleConnection.update({
      where: { userId },
      data: { status: "disconnected", disconnectedReason: "revoked" },
    });
    await book("2026-11-01", "2026-11-04");
    expect(await sync()).toMatchObject({ deferred: 1 });
    expect(google.calls).toEqual([]);
    expect(await db.calendarEventLink.findFirstOrThrow()).toMatchObject({
      syncState: "pending",
      lastError: "not_connected",
      attempts: 0,
    });
  });
});

describe("turning sync off and on", () => {
  it("schedules nothing while outbound sync is off, and everything current once on", async () => {
    await db.propertyCalendar.update({ where: { propertyId }, data: { outbound: false } });
    await book("2026-11-01", "2026-11-04");
    expect(await db.calendarEventLink.count()).toBe(0);

    await db.propertyCalendar.update({ where: { propertyId }, data: { outbound: true } });
    expect(await scheduleProperty(propertyId, new Date("2026-10-15T12:00:00Z"))).toBe(1);
    await sync();
    expect(google.events.size).toBe(1);
  });

  it("leaves existing events alone once the calendar is removed", async () => {
    const booking = await book("2026-11-01", "2026-11-04");
    await sync();
    await db.propertyCalendar.delete({ where: { propertyId } });
    await cancelBooking(booking.id);
    await sync();
    expect(google.events.size).toBe(1);
  });
});

describe("concurrent workers", () => {
  it("push each event once", async () => {
    const date = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;
    for (let day = 1; day <= 9; day += 2) await book(date(day), date(day + 1));
    const runs = await Promise.all([sync(), sync(), sync()]);
    expect(runs.reduce((sum, run) => sum + run.pushed, 0)).toBe(5);
    expect(google.events.size).toBe(5);
    expect(google.calls.filter((c) => c === "insert")).toHaveLength(5);
  });
});
