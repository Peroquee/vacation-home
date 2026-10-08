/**
 * DSGVO erasure (GitLab #100), through the API against PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => ({
    id: OWNER_ID,
    name: "Owner",
    email: "owner@example.test",
    image: null,
  }),
}));

import { PATCH as patchBooking } from "@/app/api/bookings/[id]/route";
import { GET as listBookings, POST as createBooking } from "@/app/api/bookings/route";
import { POST as purge } from "@/app/api/guests/[id]/purge/route";
import { GET as getGuest, PATCH as patchGuest } from "@/app/api/guests/[id]/route";
import { GET as search, POST as createGuest } from "@/app/api/guests/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { PURGED_GUEST_NAME } from "@/lib/guests/purge";

const BASE = "http://localhost/api/guests";
const PERSONAL = {
  name: "Zebulon Quackenbush",
  email: "zebulon.q@example.org",
  phone: "+351 912 345 678",
  notes: "Allergic to feathers; prefers the north room",
};
const BOOKING_NOTE = "Zebulon arrives late, call +351 912 345 678";

let propertyId: string;

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const purgeRequest = (id: string, confirm: unknown = id) =>
  purge(new Request(`${BASE}/${id}/purge`, send("POST", { confirm })), context(id));

async function guestWithBookings(count = 2) {
  const guest = await (await createGuest(new Request(BASE, send("POST", PERSONAL)))).json();
  for (let i = 0; i < count; i++) {
    await db.booking.create({
      data: {
        propertyId,
        guestId: guest.id,
        checkIn: toUtcDate(`2026-0${i + 1}-10`),
        checkOut: toUtcDate(`2026-0${i + 1}-14`),
        status: "confirmed",
        nightlyRateMinor: 12_345,
        cleaningFeeMinor: 4_999,
        totalAmountMinor: 4 * 12_345 + 4_999,
        currency: "EUR",
        notes: BOOKING_NOTE,
      },
    });
  }
  return guest;
}

/** Rows anywhere in these tables whose text contains `value`, any case. */
async function rowsMentioning(value: string): Promise<number> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT
      (SELECT count(*) FROM guests g WHERE row_to_json(g)::text ILIKE '%' || ${value} || '%') +
      (SELECT count(*) FROM bookings b WHERE row_to_json(b)::text ILIKE '%' || ${value} || '%') +
      (SELECT count(*) FROM audit_events a WHERE row_to_json(a)::text ILIKE '%' || ${value} || '%')
      AS n`;
  return Number(row!.n);
}

beforeAll(async () => {
  propertyId = (
    await db.property.create({
      data: { name: "Lake House", timezone: "UTC", currency: "EUR", color: "#0f766e" },
    })
  ).id;
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.guest.deleteMany();
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany({ where: { id: propertyId } });
  await db.$disconnect();
});

describe("purging a guest with bookings", () => {
  it("leaves no trace of their personal data in guests, bookings or the audit trail", async () => {
    const guest = await guestWithBookings();
    for (const value of [...Object.values(PERSONAL), "Zebulon", "912 345"]) {
      expect(await rowsMentioning(value), value).toBeGreaterThan(0);
    }

    const response = await purgeRequest(guest.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "anonymised",
      guest: {
        id: guest.id,
        name: PURGED_GUEST_NAME,
        email: null,
        phone: null,
        notes: null,
        purged: true,
      },
    });

    for (const value of [
      ...Object.values(PERSONAL),
      BOOKING_NOTE,
      "Zebulon",
      "Quackenbush",
      "912 345",
      "feathers",
    ]) {
      expect(await rowsMentioning(value), value).toBe(0);
    }
  });

  it("keeps the bookings, with dates and amounts unchanged", async () => {
    const guest = await guestWithBookings();
    const before = await db.booking.findMany({
      where: { guestId: guest.id },
      orderBy: { checkIn: "asc" },
    });

    await purgeRequest(guest.id);

    const after = await db.booking.findMany({
      where: { guestId: guest.id },
      orderBy: { checkIn: "asc" },
    });
    // Everything except the cleared notes (and the update time) must match.
    const accounting = (b: (typeof before)[number]) => ({
      ...b,
      notes: undefined,
      updatedAt: undefined,
    });
    expect(after.map(accounting)).toEqual(before.map(accounting));
    expect(after.map((b) => b.notes)).toEqual([null, null]);
  });

  it("records the purge in the audit trail without the removed data", async () => {
    const guest = await guestWithBookings(2);
    await purgeRequest(guest.id);

    const events = await db.auditEvent.findMany({ where: { subjectId: guest.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "guest.purged",
      subjectType: "guest",
      actorUserId: OWNER_ID,
      details: { bookings: 2, bookingNotesCleared: 2 },
    });
    expect(events[0]!.occurredAt).toBeInstanceOf(Date);
  });

  it("makes the guest read-only and impossible to find", async () => {
    const guest = await guestWithBookings();
    await purgeRequest(guest.id);

    const edit = await patchGuest(
      new Request(BASE, send("PATCH", { name: "Zebulon" })),
      context(guest.id),
    );
    expect(edit.status).toBe(409);

    for (const q of ["", "Deleted", "Zebulon", "zebulon.q"]) {
      const found = await (await search(new Request(`${BASE}?q=${encodeURIComponent(q)}`))).json();
      expect(found, q).toEqual([]);
    }

    // Still readable by id - its bookings point to it - as the placeholder.
    const read = await (await getGuest(new Request(BASE), context(guest.id))).json();
    expect(read).toMatchObject({ name: PURGED_GUEST_NAME, purged: true });
  });

  it("cannot be given new bookings", async () => {
    const guest = await guestWithBookings();
    await purgeRequest(guest.id);
    const response = await createBooking(
      new Request(
        "http://localhost/api/bookings",
        send("POST", {
          propertyId,
          guestId: guest.id,
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
        }),
      ),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields).toEqual({ guestId: ["has been erased"] });
  });

  it("takes no new notes on their bookings, and none moved onto them", async () => {
    const guest = await guestWithBookings(1);
    const other = await (
      await createGuest(new Request(BASE, send("POST", { name: "Other Guest" })))
    ).json();
    const otherBooking = await db.booking.create({
      data: {
        propertyId,
        guestId: other.id,
        checkIn: toUtcDate("2026-05-01"),
        checkOut: toUtcDate("2026-05-03"),
        nightlyRateMinor: 0,
        cleaningFeeMinor: 0,
        totalAmountMinor: 0,
        currency: "EUR",
      },
    });
    await purgeRequest(guest.id);
    const [own] = await db.booking.findMany({ where: { guestId: guest.id } });

    const notes = await patchBooking(
      new Request("http://localhost/api/bookings", send("PATCH", { notes: "Zebulon again" })),
      context(own!.id),
    );
    expect(notes.status).toBe(422);
    expect((await notes.json()).error.fields).toEqual({
      notes: ["cannot be set: the guest was erased"],
    });

    const moved = await patchBooking(
      new Request("http://localhost/api/bookings", send("PATCH", { guestId: guest.id })),
      context(otherBooking.id),
    );
    expect((await moved.json()).error.fields).toEqual({ guestId: ["has been erased"] });

    // The database refuses it too, for any code path.
    await expect(
      db.booking.update({ where: { id: own!.id }, data: { notes: "Zebulon" } }),
    ).rejects.toThrow(/guest_purged/);
    await expect(
      db.booking.update({ where: { id: otherBooking.id }, data: { guestId: guest.id } }),
    ).rejects.toThrow(/guest_purged/);
  });

  it("wins against a booking racing it: nothing personal is attached afterwards", async () => {
    for (let round = 0; round < 5; round++) {
      const guest = await guestWithBookings(1);
      const [purged, booked] = await Promise.all([
        purgeRequest(guest.id),
        createBooking(
          new Request(
            "http://localhost/api/bookings",
            send("POST", {
              propertyId,
              guestId: guest.id,
              checkIn: `2026-1${round % 3}-01`,
              checkOut: `2026-1${round % 3}-03`,
              notes: "Zebulon calls ahead",
            }),
          ),
        ),
      ]);
      expect(purged.status).toBe(200);
      // Either the booking came first and the purge cleared its notes, or the
      // purge came first and the booking was refused.
      expect([201, 422]).toContain(booked.status);
      expect(await rowsMentioning("Zebulon")).toBe(0);
      await db.booking.deleteMany();
      await db.guest.deleteMany();
    }
  });

  it("are not found through booking search either", async () => {
    const guest = await guestWithBookings(1);
    await purgeRequest(guest.id);
    for (const q of ["Deleted", "Zebulon"]) {
      const page = await (
        await listBookings(new Request(`http://localhost/api/bookings?q=${q}`))
      ).json();
      expect(page.items, q).toEqual([]);
    }
  });

  it("is harmless to repeat", async () => {
    const guest = await guestWithBookings();
    await purgeRequest(guest.id);
    const again = await purgeRequest(guest.id);

    expect(again.status).toBe(200);
    expect((await again.json()).outcome).toBe("already_purged");
    expect(await db.auditEvent.count({ where: { subjectId: guest.id } })).toBe(1);
    expect(await db.booking.count({ where: { guestId: guest.id } })).toBe(2);
  });

  it("wins against an edit racing it: the guest ends purged, with no personal data", async () => {
    for (let round = 0; round < 5; round++) {
      const guest = await guestWithBookings(1);
      await Promise.allSettled([
        purgeRequest(guest.id),
        patchGuest(new Request(BASE, send("PATCH", { notes: "late edit" })), context(guest.id)),
      ]);
      const row = await db.guest.findUniqueOrThrow({ where: { id: guest.id } });
      expect(row).toMatchObject({ name: PURGED_GUEST_NAME, email: null, phone: null, notes: null });
      expect(row.purgedAt).not.toBeNull();
      await db.booking.deleteMany();
      await db.guest.deleteMany();
    }
  });
});

describe("purging a guest without bookings", () => {
  it("deletes them outright, and records that", async () => {
    const guest = await (await createGuest(new Request(BASE, send("POST", PERSONAL)))).json();

    const response = await purgeRequest(guest.id);
    expect(await response.json()).toEqual({ outcome: "deleted" });
    expect(await db.guest.findUnique({ where: { id: guest.id } })).toBeNull();
    expect(await rowsMentioning("Zebulon")).toBe(0);
    expect((await db.auditEvent.findFirstOrThrow({ where: { subjectId: guest.id } })).action).toBe(
      "guest.deleted",
    );
    // Repeating answers the same, from the audit trail.
    const again = await purgeRequest(guest.id);
    expect([again.status, await again.json()]).toEqual([200, { outcome: "deleted" }]);
    // An id that was never a guest is still a 404.
    expect((await purgeRequest("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("confirmation", () => {
  it("requires the guest's id repeated in the body", async () => {
    const guest = await guestWithBookings();
    for (const confirm of ["yes", "", guest.id.toUpperCase(), true]) {
      const response = await purgeRequest(guest.id, confirm);
      expect(response.status, String(confirm)).toBe(422);
    }
    expect((await db.guest.findUniqueOrThrow({ where: { id: guest.id } })).purgedAt).toBeNull();
  });
});

describe("the database", () => {
  it("refuses personal data on a purged guest, and edits to the audit trail", async () => {
    const guest = await guestWithBookings();
    await purgeRequest(guest.id);
    await expect(
      db.guest.update({ where: { id: guest.id }, data: { phone: "+1 555 0100" } }),
    ).rejects.toThrow(/guests_purged_hold_no_personal_data/);
    await expect(
      db.guest.update({ where: { id: guest.id }, data: { name: "Zebulon" } }),
    ).rejects.toThrow(/guests_purged_hold_no_personal_data/);

    await expect(db.auditEvent.deleteMany()).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.updateMany({ data: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
  });
});
