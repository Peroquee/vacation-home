/**
 * Push notifications, with GOOGLE_WEBHOOK_URL set: the channel created on
 * polling, renewed before it expires, and the webhook accepting only
 * notifications for it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Before any import reads the configuration.
vi.hoisted(() => {
  vi.stubEnv("GOOGLE_WEBHOOK_URL", "https://vacation.example.com");
});

import { POST } from "@/app/api/google/webhook/route";
import { decideAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { saveConnection } from "@/lib/google/connection";
import { pollDueWatches } from "@/lib/google/inbound";
import { CALENDAR_SCOPE } from "@/lib/google/oauth";
import { fakeInboundCalendar } from "@/lib/google/testing/fake-calendar";

let google: ReturnType<typeof fakeInboundCalendar>;
let clock: Date;
let propertyId: string;

const poll = () =>
  pollDueWatches({ now: () => clock, calendarFor: () => google.calendar, handler: async () => {} });
const watch = () => db.calendarWatch.findUniqueOrThrow({ where: { propertyId } });
const notify = (headers: Record<string, string>) =>
  POST(new Request("http://localhost/api/google/webhook", { method: "POST", headers }));

beforeEach(async () => {
  google = fakeInboundCalendar();
  clock = new Date();
  await db.calendarWatch.deleteMany();
  await db.propertyCalendar.deleteMany();
  await db.property.deleteMany();
  await db.googleConnection.deleteMany();
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
      data: { name: "Lake", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  await db.propertyCalendar.create({
    data: {
      propertyId,
      userId,
      calendarId: "lake@group.calendar.google.com",
      outbound: false,
      inbound: true,
    },
  });
});

afterAll(() => db.$disconnect());

describe("push channels", () => {
  it("are created on the first poll, with the secret stored only as a hash", async () => {
    await poll();
    const w = await watch();
    expect(w.channelId).not.toBeNull();
    const channel = google.channels.get(w.channelId!)!;
    expect(channel.address).toBe("https://vacation.example.com/api/google/webhook");
    expect(w.channelResourceId).toBe(channel.resourceId);
    expect(w.channelTokenHash).not.toContain(channel.token);
    // With a channel, polling is only the hourly safety net.
    expect(w.nextPollAt.getTime()).toBe(clock.getTime() + 60 * 60_000);
  });

  it("are renewed a day before they expire, stopping the old one", async () => {
    await poll();
    const first = await watch();
    // Six and a half days later, and due.
    clock = new Date(first.channelExpiresAt!.getTime() - 12 * 60 * 60_000);
    await db.calendarWatch.update({ where: { propertyId }, data: { nextPollAt: clock } });
    await poll();
    const renewed = await watch();
    expect(renewed.channelId).not.toBe(first.channelId);
    expect(google.stopped).toEqual([first.channelId]);
  });
});

describe("the webhook", () => {
  it("makes the calendar due at once for a genuine notification", async () => {
    await poll();
    const w = await watch();
    const { token, resourceId } = google.channels.get(w.channelId!)!;
    const response = await notify({
      "x-goog-channel-id": w.channelId!,
      "x-goog-channel-token": token,
      "x-goog-resource-id": resourceId,
      "x-goog-resource-state": "exists",
    });
    expect(response.status).toBe(204);
    expect((await watch()).nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("refuses anything else", async () => {
    await poll();
    const w = await watch();
    const { token, resourceId } = google.channels.get(w.channelId!)!;
    const before = (await watch()).nextPollAt;
    const cases: Record<string, string>[] = [
      {},
      {
        "x-goog-channel-id": w.channelId!,
        "x-goog-channel-token": "guess",
        "x-goog-resource-id": resourceId,
      },
      {
        "x-goog-channel-id": w.channelId!,
        "x-goog-channel-token": token,
        "x-goog-resource-id": "other",
      },
      {
        "x-goog-channel-id": crypto.randomUUID(),
        "x-goog-channel-token": token,
        "x-goog-resource-id": resourceId,
      },
    ];
    for (const headers of cases) {
      expect((await notify(headers)).status).toBe(401);
    }
    expect((await watch()).nextPollAt).toEqual(before);
  });

  it("is reachable without a session, unlike the rest of the API", () => {
    expect(decideAccess({ pathname: "/api/google/webhook", search: "" }, false)).toEqual({
      kind: "allow",
    });
    expect(decideAccess({ pathname: "/api/google/webhooks", search: "" }, false)).toEqual({
      kind: "unauthorized",
    });
  });
});
