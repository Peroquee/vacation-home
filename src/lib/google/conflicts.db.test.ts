/**
 * Conflict rules (GitLab #74) end to end: edits on both sides converge to
 * the booking's version without an update loop, and an inbound event over
 * a booking becomes a visible issue rather than a silent change.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as dismiss } from "@/app/api/calendar-sync/issues/[id]/dismiss/route";
import { GET as listIssues } from "@/app/api/calendar-sync/issues/route";
import { createBooking, updateBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { saveConnection } from "./connection";
import { pollDueWatches } from "./inbound";
import { processDueLinks } from "./outbound";
import { syncSummary } from "./sync-summary";
import { fakeInboundCalendar } from "./testing/fake-calendar";
import { CALENDAR_SCOPE } from "./oauth";

const CALENDAR = "lake@group.calendar.google.com";
let google: ReturnType<typeof fakeInboundCalendar>;
let propertyId: string;
let guestId: string;
let userId: string;
let clock: Date;

const push = () => processDueLinks({ calendarFor: () => google.calendar });
const poll = () => {
  clock = new Date(clock.getTime() + 301_000);
  return pollDueWatches({ now: () => clock, calendarFor: () => google.calendar });
};
/** Lets both directions run until nothing more happens - or gives up, which would be a loop. */
async function settle() {
  for (let round = 0; round < 10; round++) {
    const before = google.writes.length;
    await poll();
    await push();
    if (google.writes.length === before) return round;
  }
  throw new Error("sync did not settle: an update loop");
}
const issues = async (query = "") =>
  (await listIssues(new Request(`http://localhost/api/calendar-sync/issues${query}`))).json();

async function book(checkIn: string, checkOut: string) {
  const result = await createBooking({
    propertyId,
    guestId,
    checkIn,
    checkOut,
    status: "confirmed",
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

beforeEach(async () => {
  google = fakeInboundCalendar();
  google.events.clear();
  clock = new Date();
  await db.calendarSyncIssue.deleteMany();
  await db.calendarEventLink.deleteMany();
  await db.calendarWatch.deleteMany();
  await db.propertyCalendar.deleteMany();
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.property.deleteMany();
  userId = (await db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` } })).id;
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
      data: { name: "Lake house", timezone: "UTC", currency: "EUR", color: "#0f766e" },
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
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

afterAll(() => db.$disconnect());

describe("edits on both sides", () => {
  it("converge to the booking's version, without an update loop", async () => {
    const booking = await book("2026-12-01", "2026-12-04");
    await push();
    const id = [...google.events.keys()][0];

    // Someone edits the event in Google, and the booking changes in the app,
    // before either side syncs.
    google.put({
      ...google.events.get(id)!,
      summary: "Renamed in Google",
      end: { date: "2026-12-10" },
    });
    await updateBooking(booking.id, { checkOut: "2026-12-05" });

    await push(); // If-Match fails: the booking wins and overwrites.
    await settle();
    expect(google.events.get(id)).toMatchObject({
      summary: "Booking · Lake house",
      end: { date: "2026-12-05" },
    });
    expect(google.events.size).toBe(1);
    // Settled: further rounds write nothing.
    expect(await settle()).toBe(0);
  });

  it("write the booking's version back over an edit made only in Google", async () => {
    await book("2026-12-01", "2026-12-04");
    await push();
    await settle();
    const id = [...google.events.keys()][0];
    google.put({ ...google.events.get(id)!, start: { date: "2026-11-28" } });

    await settle();
    expect(google.events.get(id)?.start).toEqual({ date: "2026-12-01" });
    expect(await db.block.count()).toBe(0);
  });

  it("re-create an app event deleted in Google", async () => {
    await book("2026-12-01", "2026-12-04");
    await push();
    await settle();
    google.remove([...google.events.keys()][0]);

    await settle();
    const live = [...google.events.values()].filter((e) => e.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0].start).toEqual({ date: "2026-12-01" });
  });
});

describe("an inbound event over a booking", () => {
  it("raises a visible issue instead of blocking silently, which resolves when the event moves", async () => {
    const booking = await book("2026-12-01", "2026-12-04");
    await push();
    google.put({ id: "family-visit", start: { date: "2026-12-03" }, end: { date: "2026-12-06" } });
    await poll();

    expect(await db.block.count({ where: { origin: "google" } })).toBe(0);
    const [issue] = await issues();
    expect(issue).toMatchObject({
      propertyId,
      kind: "inbound_overlap",
      googleEventId: "family-visit",
      bookingIds: [booking.id],
      startDate: "2026-12-03",
      endDate: "2026-12-06",
      resolvedAt: null,
    });
    expect(issue.message).toMatch(/overlaps a confirmed booking/);
    expect((await syncSummary(userId)).openIssues).toBe(1);

    // Seen again unchanged: still one issue.
    google.put({ ...google.events.get("family-visit")! });
    await poll();
    expect(await issues()).toHaveLength(1);

    // Moved clear of the booking in Google: imported, and the issue resolves.
    google.put({ ...google.events.get("family-visit")!, start: { date: "2026-12-04" } });
    await poll();
    expect(await db.block.count({ where: { origin: "google" } })).toBe(1);
    expect(await issues()).toEqual([]);
    expect((await issues("?status=all"))[0]).toMatchObject({ resolution: "gone" });
  });

  it("can be dismissed", async () => {
    await book("2026-12-01", "2026-12-04");
    google.put({ id: "clash", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } });
    await poll();
    const [issue] = await issues();
    const response = await dismiss(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: issue.id }),
    });
    expect((await response.json()).resolution).toBe("dismissed");
    expect(await issues()).toEqual([]);
    expect((await syncSummary(userId)).openIssues).toBe(0);
  });
});
