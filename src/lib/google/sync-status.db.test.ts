/**
 * The sync status surface (GitLab #75) against a real PostgreSQL: a forced
 * Google failure shows as failed, gives up after the configured attempts
 * (dead letter), raises the banner after an hour, and a manual retry
 * succeeds once the failure is gone.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("GOOGLE_SYNC_MAX_ATTEMPTS", "3");
});

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: session.userId,
    name: "Owner",
    email: "o@example.test",
    image: null,
  }),
}));

import { GET as badges } from "@/app/api/calendar-sync/bookings/route";
import { GET as failures } from "@/app/api/calendar-sync/failures/route";
import { POST as retry } from "@/app/api/calendar-sync/retry/route";
import { cancelBooking, createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { type CalendarClient, type CalendarEvent, GoogleCalendarError } from "./calendar";
import { saveConnection } from "./connection";
import { CALENDAR_SCOPE } from "./oauth";
import { processDueLinks } from "./outbound";
import { syncSummary } from "./sync-summary";

let failing: boolean;
const events = new Map<string, CalendarEvent>();
const calendar = {
  async insertEvent(_c: string, input: { id: string }) {
    if (failing) throw new GoogleCalendarError("server_error", 503, "backendError", 5);
    const event = { ...(input as unknown as CalendarEvent), etag: `"${events.size + 1}"` };
    events.set(input.id, event);
    return event;
  },
  async updateEvent(_c: string, id: string, input: object) {
    if (failing) throw new GoogleCalendarError("server_error", 503, "backendError", 5);
    const event = { ...(input as CalendarEvent), id, etag: `"u${events.size}"` };
    events.set(id, event);
    return event;
  },
  async deleteEvent(_c: string, id: string) {
    if (failing) throw new GoogleCalendarError("server_error", 503, "backendError", 5);
    events.delete(id);
    return "deleted" as const;
  },
} as unknown as CalendarClient;

let propertyId: string;
let guestId: string;
const push = () => processDueLinks({ calendarFor: () => calendar });
/** Lets every backoff pass, then pushes. */
async function pushLater() {
  await db.calendarEventLink.updateMany({ data: { nextAttemptAt: new Date(0) } });
  return push();
}
const badge = async (id: string) =>
  (await (await badges(new Request(`http://localhost/x?ids=${id}`))).json())[id];

async function book(checkIn = "2026-12-01", checkOut = "2026-12-04") {
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn,
    checkOut,
    status: "confirmed",
    source: "direct",
    guestCount: 1,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

beforeEach(async () => {
  failing = false;
  events.clear();
  await db.calendarEventLink.deleteMany();
  await db.propertyCalendar.deleteMany();
  await db.booking.deleteMany();
  await db.property.deleteMany();
  await db.googleConnection.deleteMany();
  session.userId = (
    await db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` } })
  ).id;
  await saveConnection(session.userId, {
    googleAccountId: "g",
    googleEmail: null,
    scope: CALENDAR_SCOPE,
    refreshToken: "r",
    accessToken: "a",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  await db.propertyCalendar.create({
    data: { propertyId, userId: session.userId, calendarId: "lake@group.calendar.google.com" },
  });
  guestId = (await db.guest.create({ data: { name: "Ada Lovelace" } })).id;
});

afterAll(() => db.$disconnect());

describe("a forced Google failure", () => {
  it("shows as failed, and a manual retry succeeds once the failure is gone", async () => {
    const booking = await book();
    expect((await badge(booking.id)).state).toBe("pending");

    failing = true;
    await push();
    expect(await badge(booking.id)).toMatchObject({
      state: "failed",
      error: "Google Calendar had a temporary problem; the app retries automatically.",
    });
    const [failure] = await (await failures()).json();
    expect(failure).toMatchObject({
      state: "failed",
      attempts: 1,
      booking: { id: booking.id, checkIn: "2026-12-01", property: { name: "Lake house" } },
    });
    expect(failure.failingSince).not.toBeNull();
    // Nothing personal in the list.
    expect(JSON.stringify(failure)).not.toContain("Ada");

    failing = false;
    const response = await retry(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId: failure.linkId }),
      }),
    );
    expect(await response.json()).toEqual({ queued: 1 });
    await push();
    expect(await badge(booking.id)).toMatchObject({ state: "synced", error: null });
    expect(events.size).toBe(1);
    expect(await (await failures()).json()).toEqual([]);
    expect(await syncSummary(session.userId)).toMatchObject({
      failed: 0,
      failingSince: null,
      alert: false,
    });
  });

  it("is given up on after the configured attempts, until retried by hand", async () => {
    const booking = await book();
    failing = true;
    await push();
    await pushLater();
    await pushLater();
    expect(await badge(booking.id)).toMatchObject({ state: "dead" });
    const [dead] = await (await failures()).json();
    expect(dead).toMatchObject({ state: "dead", attempts: 3, nextAttemptAt: null });
    // No more automatic attempts.
    failing = false;
    expect(await pushLater()).toMatchObject({ pushed: 0, failed: 0 });

    const all = await retry(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(await all.json()).toEqual({ queued: 1 });
    await push();
    expect((await badge(booking.id)).state).toBe("synced");
  });

  it("raises the banner after failing for over an hour", async () => {
    await book();
    failing = true;
    await push();
    expect(await syncSummary(session.userId)).toMatchObject({ failed: 1, dead: 0, alert: false });
    await db.calendarEventLink.updateMany({
      data: { failingSince: new Date(Date.now() - 61 * 60_000) },
    });
    expect(await syncSummary(session.userId)).toMatchObject({ alert: true });
  });

  it("keeps a failing delete as a delete when retried", async () => {
    const booking = await book();
    await push();
    await cancelBooking(booking.id);
    failing = true;
    await push();
    const [failure] = await (await failures()).json();
    expect(failure.state).toBe("delete_failing");
    failing = false;
    await retry(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(await push()).toMatchObject({ deleted: 1 });
    expect(events.size).toBe(0);
  });
});

describe("badges", () => {
  it("say not_synced for bookings without an event, and refuse bad ids", async () => {
    const guest = await db.guest.create({ data: { name: "Walk-in" } });
    const inquiry = await createBooking({
      propertyId,
      guestId: guest.id,
      checkIn: "2026-12-10",
      checkOut: "2026-12-11",
      status: "inquiry",
      source: "direct",
      guestCount: 1,
    });
    if (!("booking" in inquiry)) throw new Error();
    expect((await badge(inquiry.booking.id)).state).toBe("not_synced");
    expect((await badges(new Request("http://localhost/x?ids=nope"))).status).toBe(422);
    expect((await badges(new Request("http://localhost/x"))).status).toBe(422);
  });
});
