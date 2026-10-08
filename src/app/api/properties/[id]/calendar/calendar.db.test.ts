import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { saveConnection } from "@/lib/google/connection";
import { CALENDAR_SCOPE } from "@/lib/google/oauth";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: session.userId,
    name: "Owner",
    email: "owner@example.test",
    image: null,
  }),
}));

import { GET as listCalendars } from "@/app/api/google/calendars/route";
import { DELETE, GET, PUT } from "@/app/api/properties/[id]/calendar/route";
import { POST as resync } from "@/app/api/properties/[id]/calendar/resync/route";
import { toUtcDate } from "@/lib/calendar-date";

const CALENDARS = [
  { id: "primary@example.test", summary: "Owner", primary: true, accessRole: "owner" },
  { id: "lake@group.calendar.google.com", summary: "Lake house", accessRole: "writer" },
  { id: "holidays@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" },
];

let propertyId: string;
const context = () => ({ params: Promise.resolve({ id: propertyId }) });
const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(),
  );

beforeEach(async () => {
  await db.calendarEventLink.deleteMany();
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  await db.googleConnection.deleteMany();
  await db.user.deleteMany({ where: { email: "owner@example.test" } });
  session.userId = (await db.user.create({ data: { email: "owner@example.test" } })).id;
  await saveConnection(session.userId, {
    googleAccountId: "g-1",
    googleEmail: "owner@example.test",
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: CALENDARS })),
  );
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

describe("GET /api/google/calendars", () => {
  it("lists the calendars the user can write to, leaving out read-only ones", async () => {
    const body = await (await listCalendars()).json();
    expect(body.map((c: { id: string }) => c.id)).toEqual([
      "primary@example.test",
      "lake@group.calendar.google.com",
    ]);
  });

  it("says so when Google Calendar is not connected, or Google is down", async () => {
    await db.googleConnection.deleteMany();
    const notConnected = await listCalendars();
    expect(notConnected.status).toBe(409);
    expect((await notConnected.json()).error.reason).toBe("not_connected");

    await saveConnection(session.userId, {
      googleAccountId: "g-1",
      googleEmail: null,
      scope: CALENDAR_SCOPE,
      refreshToken: "refresh",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 400 })),
    );
    const down = await listCalendars();
    expect(down.status).toBe(502);
    expect((await down.json()).error.code).toBe("upstream_unavailable");
  });
});

describe("/api/properties/:id/calendar", () => {
  it("chooses a writable calendar and schedules the property's bookings", async () => {
    const guest = await db.guest.create({ data: { name: "Ada" } });
    await db.booking.create({
      data: {
        propertyId,
        guestId: guest.id,
        checkIn: toUtcDate("2099-01-01"),
        checkOut: toUtcDate("2099-01-03"),
        status: "confirmed",
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      },
    });
    expect(await (await GET(new Request("http://localhost/x"), context())).json()).toEqual({
      calendar: null,
    });

    const response = await put({ calendarId: "lake@group.calendar.google.com" });
    expect(response.status).toBe(200);
    expect((await response.json()).calendar).toMatchObject({
      calendarId: "lake@group.calendar.google.com",
      calendarName: "Lake house",
      outbound: true,
      inbound: false,
      userId: session.userId,
    });
    expect(await db.calendarEventLink.findMany()).toEqual([
      expect.objectContaining({ syncState: "pending", userId: session.userId }),
    ]);

    const again = await resync(new Request("http://localhost/x", { method: "POST" }), context());
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ scheduled: 1 });
  });

  it("refuses a read-only or unknown calendar, and an invalid body", async () => {
    const reader = await put({ calendarId: "holidays@group.v.calendar.google.com" });
    expect(reader.status).toBe(422);
    expect((await reader.json()).error.fields.calendarId).toEqual([
      "is not a calendar you can write to",
    ]);
    expect((await put({ calendarId: "" })).status).toBe(422);
    expect((await put({ calendarId: "x", extra: 1 })).status).toBe(422);
    expect(await db.propertyCalendar.count()).toBe(0);
  });

  it("stops syncing on DELETE, after which resync is refused", async () => {
    await put({ calendarId: "lake@group.calendar.google.com" });
    expect((await DELETE(new Request("http://localhost/x"), context())).status).toBe(204);
    expect(await db.propertyCalendar.count()).toBe(0);
    const refused = await resync(new Request("http://localhost/x", { method: "POST" }), context());
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.reason).toBe("sync_off");
  });

  it("404s an unknown property", async () => {
    propertyId = crypto.randomUUID();
    expect((await GET(new Request("http://localhost/x"), context())).status).toBe(404);
    expect((await put({ calendarId: "lake@group.calendar.google.com" })).status).toBe(404);
  });
});
