import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { type CalendarClient, type CalendarEvent, GoogleCalendarError } from "./calendar";
import { deleteRemoteEvent, ensureLink, pendingDeletes, pushEvent } from "./links";

const CALENDAR = "lake@group.calendar.google.com";
const event = {
  summary: "Booking · Lake house",
  start: { date: "2026-11-01" },
  end: { date: "2026-11-04" },
};

/** A Google Calendar in memory, holding events by id and failing on demand. */
function fakeCalendar() {
  const events = new Map<string, CalendarEvent>();
  const calls: string[] = [];
  let failNext: GoogleCalendarError | null = null;
  let version = 0;
  const write = (id: string, input: object): CalendarEvent => {
    const written = {
      ...(input as CalendarEvent),
      id,
      etag: `"${++version}"`,
      status: "confirmed" as const,
      updated: new Date().toISOString(),
    };
    events.set(id, written);
    return written;
  };
  const fail = () => {
    const error = failNext;
    failNext = null;
    if (error) throw error;
  };
  const calendar = {
    async insertEvent(_calendarId: string, input: { id?: string }) {
      calls.push("insert");
      fail();
      if (events.has(input.id!)) throw new GoogleCalendarError("conflict", 409, "duplicate", 1);
      return write(input.id!, input);
    },
    async updateEvent(_calendarId: string, eventId: string, input: object) {
      calls.push("update");
      fail();
      if (!events.has(eventId)) throw new GoogleCalendarError("not_found", 404, "notFound", 1);
      return write(eventId, input);
    },
    async deleteEvent(_calendarId: string, eventId: string) {
      calls.push("delete");
      fail();
      return events.delete(eventId) ? ("deleted" as const) : ("already_gone" as const);
    },
  } as unknown as CalendarClient;
  return {
    calendar,
    events,
    calls,
    failWith: (error: GoogleCalendarError) => (failNext = error),
  };
}

let propertyId: string;
let bookingId: string;

async function newBooking(checkIn = "2026-11-01", checkOut = "2026-11-04") {
  const guest = await db.guest.create({ data: { name: "Link test" } });
  const booking = await db.booking.create({
    data: {
      propertyId,
      guestId: guest.id,
      checkIn: toUtcDate(checkIn),
      checkOut: toUtcDate(checkOut),
      status: "confirmed",
      nightlyRateMinor: 10_000,
      cleaningFeeMinor: 0,
      totalAmountMinor: 30_000,
      currency: "EUR",
    },
  });
  return booking.id;
}

beforeEach(async () => {
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany({ where: { name: "Link test house" } });
  propertyId = (
    await db.property.create({
      data: { name: "Link test house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  bookingId = await newBooking();
});

afterAll(() => db.$disconnect());

describe("syncing a booking", () => {
  it("updates the event on a re-run instead of creating another", async () => {
    const google = fakeCalendar();
    const first = await pushEvent(
      await ensureLink({ bookingId }, CALENDAR),
      event,
      google.calendar,
    );
    expect(first).toMatchObject({ syncState: "synced", etag: '"1"', lastError: null });
    expect(first.googleEventId).toMatch(/^vh[0-9a-f]{32}$/);

    const again = await ensureLink({ bookingId }, CALENDAR);
    expect(again.id).toBe(first.id);
    const second = await pushEvent(
      again,
      { ...event, summary: "Booking · Lake house (2)" },
      google.calendar,
    );

    expect(google.calls).toEqual(["insert", "update"]);
    expect(google.events.size).toBe(1);
    expect(google.events.get(first.googleEventId)?.summary).toBe("Booking · Lake house (2)");
    expect(second.etag).toBe('"2"');
    expect(await db.calendarEventLink.count()).toBe(1);
  });

  it("creates one link even when two syncs race", async () => {
    const links = await Promise.all(
      Array.from({ length: 5 }, () => ensureLink({ bookingId }, CALENDAR)),
    );
    expect(new Set(links.map((l) => l.id)).size).toBe(1);
    expect(await db.calendarEventLink.count()).toBe(1);
  });

  it("adopts the event when an earlier insert reached Google but was not recorded", async () => {
    const google = fakeCalendar();
    const link = await ensureLink({ bookingId }, CALENDAR);
    // An earlier run inserted it, then died before writing the link.
    await google.calendar.insertEvent(CALENDAR, { ...event, id: link.googleEventId });

    const synced = await pushEvent(link, event, google.calendar);
    expect(synced.syncState).toBe("synced");
    expect(google.calls).toEqual(["insert", "insert", "update"]);
    expect(google.events.size).toBe(1);
  });

  it("records a failure by kind, and succeeds on the retry", async () => {
    const google = fakeCalendar();
    const link = await ensureLink({ bookingId }, CALENDAR);
    google.failWith(new GoogleCalendarError("rate_limited", 429, null, 5));
    await expect(pushEvent(link, event, google.calendar)).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect(await db.calendarEventLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({
      syncState: "failed",
      lastError: "rate_limited",
      lastSyncedAt: null,
    });

    const retried = await pushEvent(link, event, google.calendar);
    expect(retried).toMatchObject({ syncState: "synced", lastError: null });
    expect(google.events.size).toBe(1);
  });

  it("keeps one link per booking per calendar, and each event id unique per calendar", async () => {
    const link = await ensureLink({ bookingId }, CALENDAR);
    const other = await newBooking("2026-12-01", "2026-12-03");
    await expect(
      db.calendarEventLink.create({
        data: { bookingId, calendarId: CALENDAR, googleEventId: "vh00001" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.calendarEventLink.create({
        data: { bookingId: other, calendarId: CALENDAR, googleEventId: link.googleEventId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // The same booking in a second calendar is a second link.
    expect((await ensureLink({ bookingId }, "other@group.calendar.google.com")).id).not.toBe(
      link.id,
    );
  });
});

describe("the database", () => {
  const raw = (sql: string) => db.$executeRawUnsafe(sql);

  it("refuses a link to nothing, to two targets, or with an id Google would refuse", async () => {
    const block = await db.block.create({
      data: { propertyId, startDate: toUtcDate("2027-01-01"), endDate: toUtcDate("2027-01-02") },
    });
    await expect(
      raw(`INSERT INTO calendar_event_links (calendar_id, google_event_id, updated_at)
           VALUES ('c', 'vh00001', now())`),
    ).rejects.toThrow(/calendar_event_links_one_target/);
    await expect(
      raw(`INSERT INTO calendar_event_links (booking_id, block_id, calendar_id, google_event_id, updated_at)
           VALUES ('${bookingId}', '${block.id}', 'c', 'vh00001', now())`),
    ).rejects.toThrow(/calendar_event_links_one_target/);
    await expect(
      db.calendarEventLink.create({
        data: { bookingId, calendarId: "c", googleEventId: "Not_Base32" },
      }),
    ).rejects.toThrow(/calendar_event_links_event_id_format/);
  });
});

describe("deleting the booking", () => {
  it("keeps the link for the remote cleanup, which then removes it", async () => {
    const google = fakeCalendar();
    const link = await pushEvent(await ensureLink({ bookingId }, CALENDAR), event, google.calendar);
    await db.booking.delete({ where: { id: bookingId } });

    const [orphan] = await pendingDeletes();
    expect(orphan).toMatchObject({ id: link.id, bookingId: null, syncState: "pending_delete" });

    google.failWith(new GoogleCalendarError("server_error", 503, null, 5));
    await expect(deleteRemoteEvent(orphan, google.calendar)).rejects.toBeInstanceOf(
      GoogleCalendarError,
    );
    // Still waiting for its delete, with the reason noted.
    expect((await pendingDeletes())[0]).toMatchObject({
      syncState: "pending_delete",
      lastError: "server_error",
    });

    await deleteRemoteEvent(orphan, google.calendar);
    expect(google.events.size).toBe(0);
    expect(await db.calendarEventLink.count()).toBe(0);

    // Running it again - the event long gone - is harmless.
    await deleteRemoteEvent(orphan, google.calendar);
  });

  it("leaves a booking deleted mid-push waiting for its remote delete", async () => {
    const google = fakeCalendar();
    const link = await ensureLink({ bookingId }, CALENDAR);
    const slow = {
      ...google.calendar,
      insertEvent: async (calendarId: string, input: { id?: string }) => {
        const written = await google.calendar.insertEvent(calendarId, input as never);
        await db.booking.delete({ where: { id: bookingId } });
        return written;
      },
    } as CalendarClient;
    expect(await pushEvent(link, event, slow)).toMatchObject({ syncState: "pending_delete" });
    expect(await pendingDeletes()).toHaveLength(1);
  });

  it("does the same for a block, also when its property goes", async () => {
    const block = await db.block.create({
      data: { propertyId, startDate: toUtcDate("2027-01-01"), endDate: toUtcDate("2027-01-02") },
    });
    await ensureLink({ blockId: block.id }, CALENDAR);
    await db.booking.deleteMany();
    await db.property.delete({ where: { id: propertyId } });
    expect(await pendingDeletes()).toEqual([
      expect.objectContaining({ blockId: null, syncState: "pending_delete" }),
    ]);
  });
});
