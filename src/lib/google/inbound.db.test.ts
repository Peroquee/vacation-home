/**
 * Inbound polling against a real PostgreSQL and an in-memory Google
 * Calendar (no push channel: GOOGLE_WEBHOOK_URL is unset here).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";

import { saveConnection } from "./connection";
import { type InboundBatch, pollDueWatches } from "./inbound";
import { CALENDAR_SCOPE } from "./oauth";
import { fakeInboundCalendar } from "./testing/fake-calendar";

const CALENDAR = "family@group.calendar.google.com";
let google: ReturnType<typeof fakeInboundCalendar>;
let batches: InboundBatch[];
let failHandler: boolean;
let clock: Date;
let userId: string;
let propertyId: string;

const poll = () =>
  pollDueWatches({
    now: () => clock,
    calendarFor: () => google.calendar,
    handler: async (batch) => {
      if (failHandler) throw new Error("import failed");
      batches.push(batch);
    },
  });
const later = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const ids = (batch: InboundBatch) => batch.events.map((e) => e.id).sort();
const watch = () => db.calendarWatch.findUniqueOrThrow({ where: { propertyId } });

beforeEach(async () => {
  google = fakeInboundCalendar();
  batches = [];
  failHandler = false;
  clock = new Date();
  await db.calendarWatch.deleteMany();
  await db.propertyCalendar.deleteMany();
  await db.property.deleteMany();
  await db.googleConnection.deleteMany();
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
    data: { propertyId, userId, calendarId: CALENDAR, outbound: false, inbound: true },
  });
  google.put({ id: "family-visit" });
  google.put({ id: "roof-repair" });
});

afterAll(() => db.$disconnect());

describe("polling", () => {
  it("starts with a full list, then fetches only what changed", async () => {
    expect(await poll()).toMatchObject({ polled: 1, full: 1, changes: 2 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ propertyId, calendarId: CALENDAR, full: true });
    expect(ids(batches[0])).toEqual(["family-visit", "roof-repair"]);
    expect(await watch()).toMatchObject({ syncToken: "t2", attempts: 0, lastError: null });

    // Not due yet: nothing happens.
    google.put({ id: "new-event" });
    later(60);
    expect(await poll()).toMatchObject({ polled: 0 });

    // Due after the poll interval (300 s by default): the change only.
    later(300);
    google.remove("roof-repair");
    expect(await poll()).toMatchObject({ polled: 1, full: 0, changes: 2 });
    expect(batches[1].full).toBe(false);
    expect(ids(batches[1])).toEqual(["new-event", "roof-repair"]);
    expect(batches[1].events.find((e) => e.id === "roof-repair")?.status).toBe("cancelled");
    expect(google.lists.at(-1)).toEqual({ syncToken: "t2" });
  });

  it("does a full resync when the sync token has expired, rather than losing changes", async () => {
    await poll();
    google.expireTokens();
    google.put({ id: "after-expiry" });
    later(301);
    expect(await poll()).toMatchObject({ polled: 1, full: 1 });
    expect(batches[1].full).toBe(true);
    expect(ids(batches[1])).toEqual(["after-expiry", "family-visit", "roof-repair"]);
    expect((await watch()).lastFullSyncAt).toEqual(clock);
  });

  it("keeps the sync token when the import fails, so the same changes come again", async () => {
    await poll();
    google.put({ id: "missed-once" });
    later(301);
    failHandler = true;
    expect(await poll()).toMatchObject({ failed: 1 });
    const failed = await watch();
    expect(failed).toMatchObject({ syncToken: "t2", attempts: 1, lastError: "unexpected_error" });

    failHandler = false;
    clock = new Date(failed.nextPollAt.getTime() + 1);
    await poll();
    expect(ids(batches[1])).toEqual(["missed-once"]);
  });

  it("backs off when Google fails", async () => {
    google.failNext();
    expect(await poll()).toMatchObject({ failed: 1 });
    const failed = await watch();
    expect(failed).toMatchObject({ syncToken: null, attempts: 1, lastError: "server_error" });
    expect(failed.nextPollAt.getTime()).toBe(clock.getTime() + 30_000);
    expect(await poll()).toMatchObject({ polled: 0, failed: 0 });
  });

  it("waits, without calling Google, while the account is disconnected", async () => {
    await db.googleConnection.update({ where: { userId }, data: { status: "disconnected" } });
    expect(await poll()).toMatchObject({ deferred: 1 });
    expect(google.lists).toEqual([]);
  });
});

describe("following the settings", () => {
  it("stops watching when inbound sync is turned off", async () => {
    await poll();
    await db.propertyCalendar.update({ where: { propertyId }, data: { inbound: false } });
    later(301);
    await poll();
    expect(await db.calendarWatch.count()).toBe(0);
    expect(batches).toHaveLength(1);
  });

  it("starts afresh with a full list when the calendar changes", async () => {
    await poll();
    await db.propertyCalendar.update({
      where: { propertyId },
      data: { calendarId: "other@group.calendar.google.com" },
    });
    await poll();
    expect(batches[1]).toMatchObject({ calendarId: "other@group.calendar.google.com", full: true });
  });

  it("polls each calendar once even with workers running at the same time", async () => {
    const runs = await Promise.all([poll(), poll(), poll()]);
    expect(runs.reduce((n, r) => n + r.polled, 0)).toBe(1);
    expect(batches).toHaveLength(1);
  });
});
