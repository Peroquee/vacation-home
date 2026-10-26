/**
 * A booking platform's feed against a real PostgreSQL: stays become `ical`
 * blocks, move and go with the feed, and a stay on a confirmed booking's
 * dates is a double booking raised for review, not a block.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { buildFeed } from "./export";
import { createFeed, deleteFeed, enableExport, propertyForToken } from "./feeds";
import { importDueFeeds, importFeed } from "./import";

const now = new Date("2026-10-09T10:00:00Z");
let propertyId: string;
let feedId: string;
let body: string;
let status = 200;

const fetcher = (async () => new Response(body, { status })) as unknown as typeof fetch;
const run = () => importFeed(feedId, { now, fetcher });

const ics = (...events: [uid: string, start: string, end: string][]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap(([uid, start, end]) => [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART;VALUE=DATE:${start.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.replaceAll("-", "")}`,
      "SUMMARY:Reserved",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const blocks = async () =>
  (
    await db.block.findMany({
      where: { propertyId, origin: "ical" },
      orderBy: { startDate: "asc" },
    })
  ).map((b) => [
    b.reason,
    b.startDate.toISOString().slice(0, 10),
    b.endDate.toISOString().slice(0, 10),
  ]);

async function confirmed(checkIn: string, checkOut: string) {
  const guest = await db.guest.create({ data: { name: "Ada" } });
  const result = await createBooking({
    propertyId,
    guestId: guest.id,
    checkIn,
    checkOut,
    status: "confirmed",
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error("booking refused");
  return result.booking;
}

beforeEach(async () => {
  status = 200;
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  feedId = (await createFeed(propertyId, { name: "Airbnb", url: "https://airbnb.test/x.ics" })).id;
});

afterAll(() => db.$disconnect());

describe("importing a feed", () => {
  it("turns stays into read-only blocks named after the feed", async () => {
    body = ics(["a@airbnb", "2026-11-02", "2026-11-05"], ["b@airbnb", "2026-11-10", "2026-11-12"]);
    expect(await run()).toMatchObject({ kind: "imported", created: 2, conflicts: 0 });
    expect(await blocks()).toEqual([
      ["Airbnb", "2026-11-02", "2026-11-05"],
      ["Airbnb", "2026-11-10", "2026-11-12"],
    ]);
    const feed = await db.icalFeed.findUniqueOrThrow({ where: { id: feedId } });
    expect(feed).toMatchObject({ eventCount: 2, conflictCount: 0, lastError: null });
  });

  it("moves a stay, and removes a current one gone from the feed, but keeps the past", async () => {
    body = ics(
      ["past@airbnb", "2026-09-01", "2026-09-04"],
      ["a@airbnb", "2026-11-02", "2026-11-05"],
      ["b@airbnb", "2026-11-10", "2026-11-12"],
    );
    await run();
    body = ics(["a@airbnb", "2026-11-03", "2026-11-06"]);
    expect(await run()).toMatchObject({ kind: "imported", updated: 1, deleted: 1 });
    expect(await blocks()).toEqual([
      ["Airbnb", "2026-09-01", "2026-09-04"],
      ["Airbnb", "2026-11-03", "2026-11-06"],
    ]);
  });

  it("raises a stay on a confirmed booking's dates as a double booking, until it is gone", async () => {
    const booking = await confirmed("2026-11-03", "2026-11-06");
    body = ics(["clash@airbnb", "2026-11-04", "2026-11-08"]);
    expect(await run()).toMatchObject({ kind: "imported", created: 0, conflicts: 1 });
    expect(await blocks()).toEqual([]);

    const issues = await db.calendarSyncIssue.findMany({ where: { propertyId } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "ical_overlap",
      feedId,
      eventUid: "clash@airbnb",
      bookingIds: [booking.id],
      resolvedAt: null,
    });

    // Fetched again: still one open issue, not a second.
    await run();
    expect(await db.calendarSyncIssue.count({ where: { propertyId, resolvedAt: null } })).toBe(1);

    // Cancelled on the platform: the stay leaves the feed, the issue resolves.
    body = ics();
    await run();
    const [issue] = await db.calendarSyncIssue.findMany({ where: { propertyId } });
    expect(issue).toMatchObject({ resolution: "gone" });
    expect(issue!.resolvedAt).not.toBeNull();
  });

  it("records a failure and leaves the blocks alone", async () => {
    body = ics(["a@airbnb", "2026-11-02", "2026-11-05"]);
    await run();
    status = 404;
    expect(await run()).toEqual({ kind: "failed", code: "http_404" });
    status = 200;
    body = "<html>Sign in</html>";
    expect(await run()).toEqual({ kind: "failed", code: "not_ical" });
    expect(await blocks()).toHaveLength(1);
    expect((await db.icalFeed.findUniqueOrThrow({ where: { id: feedId } })).lastError).toBe(
      "not_ical",
    );
  });

  it("takes due feeds once each, and none of an archived property", async () => {
    body = ics();
    await db.icalFeed.update({ where: { id: feedId }, data: { nextFetchAt: now } });
    const first = await importDueFeeds(now, fetcher);
    expect(first.fetched).toBeGreaterThanOrEqual(1);
    expect((await db.icalFeed.findUniqueOrThrow({ where: { id: feedId } })).nextFetchAt > now).toBe(
      true,
    );
    await db.property.update({ where: { id: propertyId }, data: { archivedAt: now } });
    await db.icalFeed.update({ where: { id: feedId }, data: { nextFetchAt: now } });
    await importDueFeeds(now, fetcher);
    expect((await db.icalFeed.findUniqueOrThrow({ where: { id: feedId } })).nextFetchAt).toEqual(
      now,
    );
  });

  it("deletes a feed with its blocks and issues", async () => {
    await confirmed("2026-11-20", "2026-11-22");
    body = ics(["a@airbnb", "2026-11-02", "2026-11-05"], ["c@airbnb", "2026-11-21", "2026-11-23"]);
    await run();
    expect(await deleteFeed(feedId)).toBe(true);
    expect(await blocks()).toEqual([]);
    expect(await db.calendarSyncIssue.count({ where: { propertyId } })).toBe(0);
  });
});

// GitLab #144: a feed that suddenly lists far fewer stays, or one it can't
// read, must not free the dates on the public calendar.
describe("a feed that would free many dates at once", () => {
  const three = () =>
    ics(
      ["a@airbnb", "2026-11-02", "2026-11-05"],
      ["b@airbnb", "2026-11-10", "2026-11-12"],
      ["c@airbnb", "2026-11-20", "2026-11-23"],
    );
  const feed = () => db.icalFeed.findUniqueOrThrow({ where: { id: feedId } });
  const withRaw = (...vevents: string[][]) =>
    three().replace("END:VCALENDAR", [...vevents.flat(), "END:VCALENDAR"].join("\r\n"));

  it("keeps every block when the feed comes back empty, until a second fetch agrees", async () => {
    body = three();
    await run();
    body = ics();
    expect(await run()).toMatchObject({ kind: "imported", deleted: 0, held: 3 });
    expect(await blocks()).toHaveLength(3);
    expect(await feed()).toMatchObject({
      heldRemovals: ["a@airbnb", "b@airbnb", "c@airbnb"],
      heldSince: now,
      // Fetched in full next time, never answered with a 304.
      etag: null,
      lastModified: null,
    });

    expect(await run()).toMatchObject({ kind: "imported", deleted: 3, held: 0 });
    expect(await blocks()).toEqual([]);
    expect(await feed()).toMatchObject({ heldRemovals: [], heldSince: null });
  });

  it("starts the wait again when the second fetch wants something else", async () => {
    body = three();
    await run();
    body = ics();
    await run();
    // a is back; b and c are still missing: a different removal, so it waits again.
    body = ics(["a@airbnb", "2026-11-02", "2026-11-05"]);
    expect(await run()).toMatchObject({ deleted: 0, held: 2 });
    expect((await feed()).heldRemovals).toEqual(["b@airbnb", "c@airbnb"]);
    expect(await run()).toMatchObject({ deleted: 2, held: 0 });
    expect(await blocks()).toEqual([["Airbnb", "2026-11-02", "2026-11-05"]]);
  });

  it("removes the one block of a stay cancelled on the platform straight away", async () => {
    body = three();
    await run();
    body = ics(["a@airbnb", "2026-11-02", "2026-11-05"], ["b@airbnb", "2026-11-10", "2026-11-12"]);
    expect(await run()).toMatchObject({ deleted: 1, held: 0 });
    expect(await blocks()).toHaveLength(2);
  });

  it("keeps the block of a stay it can't read, and says how many it couldn't", async () => {
    body = three();
    await run();
    body = ics(
      ["a@airbnb", "2026-11-02", "2026-11-05"],
      ["b@airbnb", "2026-11-10", "2026-11-12"],
    ).replace(
      "END:VCALENDAR",
      ["BEGIN:VEVENT", "UID:c@airbnb", "SUMMARY:Reserved", "END:VEVENT", "END:VCALENDAR"].join(
        "\r\n",
      ),
    );
    expect(await run()).toMatchObject({ deleted: 0, held: 0 });
    expect(await blocks()).toHaveLength(3);
    expect((await feed()).droppedEventCount).toBe(1);
  });

  it("removes nothing while the feed has an event without a UID", async () => {
    body = three();
    await run();
    body = withRaw(["BEGIN:VEVENT", "SUMMARY:Reserved", "END:VEVENT"]).replace(
      /BEGIN:VEVENT\r\nUID:c@airbnb[\s\S]*?END:VEVENT\r\n/,
      "",
    );
    expect(await run()).toMatchObject({ deleted: 0 });
    expect(await blocks()).toHaveLength(3);
    expect((await feed()).droppedEventCount).toBe(1);
  });
});

describe("the export token", () => {
  it("is off until switched on, and regenerating retires the old one", async () => {
    expect(await db.property.findUniqueOrThrow({ where: { id: propertyId } })).toMatchObject({
      icalExportToken: null,
    });
    const first = await enableExport(propertyId, false);
    const token = first!.url!.match(/ical\/(.+)\.ics$/)![1]!;
    expect(await propertyForToken(token)).toMatchObject({ id: propertyId });
    expect((await enableExport(propertyId, false))!.url).toBe(first!.url);

    const rotated = await enableExport(propertyId, true);
    expect(rotated!.url).not.toBe(first!.url);
    expect(await propertyForToken(token)).toBeNull();
  });
});

it("builds a feed the import reads back", () => {
  const feed = buildFeed({
    propertyName: "Lake house",
    today: "2026-10-09",
    entries: [{ kind: "booking", id: "x", start: "2026-11-01", end: "2026-11-03" }],
  });
  expect(feed).toContain("SUMMARY:Booked");
});
