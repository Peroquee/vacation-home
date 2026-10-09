/**
 * Cross-account access: every allow-listed user shares the household's
 * properties, bookings and ledger by design, but a Google connection is
 * personal. One user can neither see, use nor remove another's.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { saveConnection } from "@/lib/google/connection";
import { CALENDAR_SCOPE } from "@/lib/google/oauth";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: session.userId,
    name: "User",
    email: "user@example.test",
    image: null,
  }),
}));

import { GET as calendars } from "@/app/api/google/calendars/route";
import { DELETE, GET } from "@/app/api/google/connection/route";
import { PUT as setCalendar } from "@/app/api/properties/[id]/calendar/route";

let alice: string;
let bob: string;
const as = (userId: string) => (session.userId = userId);
const status = async () => (await GET()).json();

beforeEach(async () => {
  await db.calendarEventLink.deleteMany();
  await db.googleConnection.deleteMany();
  alice = (await db.user.create({ data: { email: `alice-${crypto.randomUUID()}@example.test` } }))
    .id;
  bob = (await db.user.create({ data: { email: `bob-${crypto.randomUUID()}@example.test` } })).id;
  await saveConnection(alice, {
    googleAccountId: "alice-google",
    googleEmail: "alice@gmail.example",
    scope: CALENDAR_SCOPE,
    refreshToken: "alice-refresh-token",
    accessToken: "alice-access-token",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ items: [{ id: "alice-cal", summary: "A", accessRole: "owner" }] }),
    ),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});

describe("a Google connection is its owner's alone", () => {
  it("is not shown to another user", async () => {
    as(bob);
    expect(await status()).toEqual({ available: true, status: "not_connected", sync: null });
    as(alice);
    const own = await status();
    expect(own).toMatchObject({ status: "connected", googleEmail: "alice@gmail.example" });
    // Never a token, encrypted or not.
    expect(JSON.stringify(own)).not.toMatch(/token|Encrypted/i);
  });

  it("cannot be used by another user", async () => {
    as(bob);
    const response = await calendars();
    expect(response.status).toBe(409);
    expect((await response.json()).error.reason).toBe("not_connected");

    const property = await db.property.create({
      data: { name: "Lake", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    });
    const put = await setCalendar(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId: "alice-cal" }),
      }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(put.status).toBe(409);
    expect(await db.propertyCalendar.count()).toBe(0);
  });

  it("cannot be removed by another user", async () => {
    as(bob);
    expect((await DELETE()).status).toBe(204);
    expect(await db.googleConnection.count({ where: { userId: alice } })).toBe(1);
  });

  it("reports sync of its own events only", async () => {
    const property = await db.property.create({
      data: { name: "Lake", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    });
    const guest = await db.guest.create({ data: { name: "Ada" } });
    const booking = await db.booking.create({
      data: {
        propertyId: property.id,
        guestId: guest.id,
        checkIn: new Date("2026-12-01"),
        checkOut: new Date("2026-12-02"),
        status: "confirmed",
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      },
    });
    await db.calendarEventLink.create({
      data: {
        bookingId: booking.id,
        calendarId: "alice-cal",
        googleEventId: "vh00001",
        userId: alice,
        syncState: "failed",
        lastError: "rate_limited",
      },
    });
    await saveConnection(bob, {
      googleAccountId: "bob-google",
      googleEmail: null,
      scope: CALENDAR_SCOPE,
      refreshToken: "bob-refresh",
      accessToken: "bob-access",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    as(bob);
    expect((await status()).sync).toMatchObject({ failed: 0, lastError: null });
    as(alice);
    expect((await status()).sync).toMatchObject({ failed: 1 });
  });
});
