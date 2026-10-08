import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/availability/route";
import { POST as cancelBooking } from "@/app/api/bookings/[id]/cancel/route";
import { PATCH as patchBooking } from "@/app/api/bookings/[id]/route";
import { POST as createBooking } from "@/app/api/bookings/route";
import { PATCH as patchProperty } from "@/app/api/properties/[id]/route";
import { clearWindows } from "@/lib/availability/cache";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

let lake: string;
let cabin: string;
let guestId: string;

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function calendar(propertyIds: string[], from: string, to: string) {
  const response = await GET(
    new Request(
      `http://localhost/api/availability?propertyIds=${propertyIds.join(",")}&from=${from}&to=${to}`,
    ),
  );
  return { status: response.status, body: await response.json() };
}
async function book(propertyId: string, checkIn: string, checkOut: string) {
  const response = await createBooking(
    new Request(
      "http://localhost/api/bookings",
      send("POST", { propertyId, guestId, checkIn, checkOut, status: "confirmed" }),
    ),
  );
  expect(response.status).toBe(201);
  return response.json();
}
/** Writes behind the app's back, so only a stale cache would hide it. */
const insertDirectly = (propertyId: string, start: string, end: string) =>
  db.block.create({
    data: { propertyId, startDate: toUtcDate(start), endDate: toUtcDate(end), reason: "Direct" },
  });

beforeAll(async () => {
  const property = (name: string, color: string) =>
    db.property.create({ data: { name, timezone: "Europe/Lisbon", currency: "EUR", color } });
  lake = (await property("Lake House", "#0f766e")).id;
  cabin = (await property("Mountain Cabin", "#7c3aed")).id;
  guestId = (await db.guest.create({ data: { name: "Ada Lovelace" } })).id;
});

beforeEach(async () => {
  clearWindows();
  await db.booking.deleteMany();
  await db.block.deleteMany();
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany({ where: { id: guestId } });
  await db.property.deleteMany({ where: { id: { in: [lake, cabin] } } });
  await db.$disconnect();
});

describe("GET /api/availability", () => {
  it("resolves a three-month window for two properties in one request", async () => {
    const stay = await book(lake, "2026-07-14", "2026-07-18");
    await book(cabin, "2026-08-30", "2026-09-02");
    await insertDirectly(cabin, "2026-09-10", "2026-09-12");

    const { status, body } = await calendar([lake, cabin], "2026-07-01", "2026-10-01");
    expect(status).toBe(200);
    expect(body.properties.map((p: { property: { name: string } }) => p.property.name)).toEqual([
      "Lake House",
      "Mountain Cabin",
    ]);

    const [lakeView, cabinView] = body.properties;
    expect(lakeView.days).toHaveLength(92);
    expect(lakeView.bookings).toEqual([
      {
        id: stay.id,
        checkIn: "2026-07-14",
        checkOut: "2026-07-18",
        status: "confirmed",
        source: "direct",
        guest: { id: guestId, name: "Ada Lovelace" },
      },
    ]);
    expect(lakeView.days[13]).toMatchObject({
      date: "2026-07-14",
      status: "booked",
      checkIn: true,
    });
    expect(cabinView.property).toMatchObject({ color: "#7c3aed", timezone: "Europe/Lisbon" });
    expect(cabinView.blocks).toHaveLength(1);
    expect(cabinView.days.find((d: { date: string }) => d.date === "2026-09-10").status).toBe(
      "blocked",
    );
  });

  it("loads several uncached properties together and keeps the order asked for", async () => {
    const both = await calendar([cabin, lake], "2026-07-01", "2026-08-01");
    expect(both.body.properties.map((p: { property: { id: string } }) => p.property.id)).toEqual([
      cabin,
      lake,
    ]);
    // One cached, one not: still in order.
    clearWindows();
    await calendar([lake], "2026-07-01", "2026-08-01");
    const mixed = await calendar([cabin, lake], "2026-07-01", "2026-08-01");
    expect(mixed.body.properties.map((p: { property: { id: string } }) => p.property.id)).toEqual([
      cabin,
      lake,
    ]);
  });

  it("serves a repeated window from the cache", async () => {
    await calendar([lake], "2026-07-01", "2026-10-01");
    await insertDirectly(lake, "2026-07-20", "2026-07-22");
    const again = await calendar([lake], "2026-07-01", "2026-10-01");
    expect(again.body.properties[0].blocks).toEqual([]); // cached, as intended
  });

  it("invalidates the cached window covering a new booking", async () => {
    await calendar([lake], "2026-07-01", "2026-10-01");
    await insertDirectly(lake, "2026-08-01", "2026-08-03"); // hidden by the cache...
    await book(lake, "2026-07-14", "2026-07-18"); // ...until a booking in the window

    const fresh = await calendar([lake], "2026-07-01", "2026-10-01");
    expect(fresh.body.properties[0].bookings).toHaveLength(1);
    expect(fresh.body.properties[0].blocks).toHaveLength(1);
  });

  it("keeps windows a booking does not touch, and other properties' windows", async () => {
    await calendar([lake], "2026-07-01", "2026-08-01");
    await calendar([lake], "2026-09-01", "2026-10-01");
    await calendar([cabin], "2026-07-01", "2026-08-01");
    await insertDirectly(lake, "2026-07-25", "2026-07-26");
    await insertDirectly(lake, "2026-09-25", "2026-09-26");
    await insertDirectly(cabin, "2026-07-25", "2026-07-26");

    await book(lake, "2026-07-10", "2026-07-12");

    expect(
      (await calendar([lake], "2026-07-01", "2026-08-01")).body.properties[0].blocks,
    ).toHaveLength(1);
    expect(
      (await calendar([lake], "2026-09-01", "2026-10-01")).body.properties[0].blocks,
    ).toHaveLength(0);
    expect(
      (await calendar([cabin], "2026-07-01", "2026-08-01")).body.properties[0].blocks,
    ).toHaveLength(0);
  });

  it("invalidates both the old and the new dates when a booking moves, and on cancel", async () => {
    const stay = await book(lake, "2026-07-14", "2026-07-18");
    await calendar([lake], "2026-07-01", "2026-08-01");
    await calendar([lake], "2026-09-01", "2026-10-01");

    await patchBooking(
      new Request(
        "http://localhost",
        send("PATCH", { checkIn: "2026-09-14", checkOut: "2026-09-18" }),
      ),
      context(stay.id),
    );
    expect(
      (await calendar([lake], "2026-07-01", "2026-08-01")).body.properties[0].bookings,
    ).toEqual([]);
    expect(
      (await calendar([lake], "2026-09-01", "2026-10-01")).body.properties[0].bookings,
    ).toHaveLength(1);

    await cancelBooking(new Request("http://localhost"), context(stay.id));
    expect(
      (await calendar([lake], "2026-09-01", "2026-10-01")).body.properties[0].bookings,
    ).toEqual([]);
  });

  it("reflects a property's new colour at once", async () => {
    await calendar([lake], "2026-07-01", "2026-08-01");
    await patchProperty(
      new Request("http://localhost", send("PATCH", { color: "#123456" })),
      context(lake),
    );
    const view = await calendar([lake], "2026-07-01", "2026-08-01");
    expect(view.body.properties[0].property.color).toBe("#123456");
    await patchProperty(
      new Request("http://localhost", send("PATCH", { color: "#0f766e" })),
      context(lake),
    );
  });

  it("validates the request", async () => {
    const missing = await calendar(
      ["00000000-0000-4000-8000-000000000000"],
      "2026-07-01",
      "2026-08-01",
    );
    expect(missing.status).toBe(422);
    expect(missing.body.error.fields.propertyIds[0]).toMatch(/unknown/);

    expect(
      (await calendar([], "2026-07-01", "2026-08-01")).body.error.fields.propertyIds,
    ).toBeDefined();
    expect((await calendar([lake], "2026-08-01", "2026-07-01")).body.error.fields.to).toEqual([
      "must be after from",
    ]);
    expect((await calendar([lake], "2026-01-01", "2027-06-01")).body.error.fields.to[0]).toMatch(
      /366/,
    );
    expect((await calendar(["nope"], "2026-07-01", "2026-08-01")).status).toBe(422);
    const malformed = await calendar([lake], "2026-7-1", "2026-08-01");
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.fields.from).toEqual(["must be a date as YYYY-MM-DD"]);
  });
});
