/**
 * The block API through its route handlers against a real PostgreSQL:
 * CRUD, conflicts with confirmed bookings, and the read-only Google blocks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET as getOne, PATCH } from "@/app/api/blocks/[id]/route";
import { GET as list, POST as create } from "@/app/api/blocks/route";
import { getAvailability } from "@/lib/availability/service";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

const BASE = "http://localhost/api/blocks";
let lake: string;
let sea: string;
let guestId: string;

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function post(body: Record<string, unknown>) {
  const response = await create(new Request(BASE, send("POST", { propertyId: lake, ...body })));
  return { status: response.status, body: await response.json(), response };
}
async function patch(id: string, body: Record<string, unknown>) {
  const response = await PATCH(new Request(BASE, send("PATCH", body)), context(id));
  return { status: response.status, body: await response.json() };
}
async function listed(query: string) {
  const response = await list(new Request(`${BASE}?${query}`));
  return { status: response.status, body: await response.json() };
}
function booking(checkIn: string, checkOut: string, status: "confirmed" | "inquiry" = "confirmed") {
  return db.booking.create({
    data: {
      propertyId: lake,
      guestId,
      checkIn: toUtcDate(checkIn),
      checkOut: toUtcDate(checkOut),
      status,
      nightlyRateMinor: 10_000,
      cleaningFeeMinor: 0,
      totalAmountMinor: 0,
      currency: "EUR",
    },
  });
}
const googleBlock = () =>
  db.block.create({
    data: {
      propertyId: lake,
      startDate: toUtcDate("2026-12-20"),
      endDate: toUtcDate("2026-12-27"),
      reason: "Family Christmas",
      origin: "google",
      externalEventId: "abc123",
    },
  });

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany();
  await db.property.deleteMany();
  const property = (name: string, archivedAt: Date | null = null) =>
    db.property.create({
      data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e", archivedAt },
    });
  lake = (await property("Lake house")).id;
  sea = (await property("Sea cottage")).id;
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

afterAll(() => db.$disconnect());

describe("create", () => {
  it("creates a manual block, which then makes the dates unavailable", async () => {
    const { status, body, response } = await post({
      startDate: "2026-11-02",
      endDate: "2026-11-05",
      reason: " Painting ",
    });
    expect(status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/blocks/${body.id}`);
    expect(body).toMatchObject({
      propertyId: lake,
      startDate: "2026-11-02",
      endDate: "2026-11-05",
      reason: "Painting",
      origin: "manual",
      readOnly: false,
    });
    const days = await getAvailability(lake, "2026-11-01", "2026-11-06");
    expect(days.map((d) => d.status)).toEqual([
      "available",
      "blocked",
      "blocked",
      "blocked",
      "available",
    ]);
  });

  it("refuses dates shared with a confirmed booking, naming it", async () => {
    const stay = await booking("2026-11-03", "2026-11-06");
    const { status, body } = await post({ startDate: "2026-11-01", endDate: "2026-11-04" });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({
      code: "conflict",
      reason: "overlap",
      conflicts: [{ kind: "booking", id: stay.id, start: "2026-11-03", end: "2026-11-06" }],
    });
    expect(await db.block.count()).toBe(0);
  });

  it("allows the check-out day, inquiries, other properties and other blocks", async () => {
    await booking("2026-11-01", "2026-11-04");
    await booking("2026-11-10", "2026-11-12", "inquiry");
    expect((await post({ startDate: "2026-11-04", endDate: "2026-11-06" })).status).toBe(201);
    expect((await post({ startDate: "2026-11-10", endDate: "2026-11-12" })).status).toBe(201);
    expect((await post({ startDate: "2026-11-05", endDate: "2026-11-08" })).status).toBe(201);
    expect(
      (await post({ propertyId: sea, startDate: "2026-11-01", endDate: "2026-11-04" })).status,
    ).toBe(201);
  });

  it("rejects invalid input with a 422 per field", async () => {
    const { status, body } = await post({
      propertyId: "nope",
      startDate: "2026-02-30",
      endDate: "x",
      origin: "google",
    });
    expect(status).toBe(422);
    expect(Object.keys(body.error.fields).sort()).toEqual([
      "_",
      "endDate",
      "propertyId",
      "startDate",
    ]);

    const backwards = await post({ startDate: "2026-11-05", endDate: "2026-11-05" });
    expect(backwards.body.error.fields.endDate).toEqual(["must be after the start date"]);
    const long = await post({ startDate: "2026-01-01", endDate: "2028-01-02" });
    expect(long.body.error.fields.endDate).toEqual(["a block can be at most 730 nights"]);
  });

  it("refuses a property that does not exist or is archived", async () => {
    const missing = await post({
      propertyId: "00000000-0000-4000-8000-000000000000",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
    });
    expect(missing.body.error.fields.propertyId).toEqual(["does not exist"]);
    await db.property.update({ where: { id: lake }, data: { archivedAt: new Date() } });
    const archived = await post({ startDate: "2026-11-01", endDate: "2026-11-02" });
    expect(archived.body.error.fields.propertyId).toEqual(["is archived"]);
  });
});

describe("list and read", () => {
  it("filters by property and by overlap with from/to, by start date", async () => {
    await post({ startDate: "2026-11-10", endDate: "2026-11-12" });
    await post({ startDate: "2026-11-01", endDate: "2026-11-03" });
    await post({ propertyId: sea, startDate: "2026-11-01", endDate: "2026-11-03" });
    await googleBlock();

    const lakeOnly = await listed(`propertyId=${lake}`);
    expect(lakeOnly.body).toMatchObject({ total: 3, page: 1, pageSize: 100 });
    expect(lakeOnly.body.items.map((b: { startDate: string }) => b.startDate)).toEqual([
      "2026-11-01",
      "2026-11-10",
      "2026-12-20",
    ]);
    // Ending on `from` does not overlap; starting on `to` does not either.
    const window = await listed(`propertyId=${lake}&from=2026-11-03&to=2026-12-20`);
    expect(window.body.items.map((b: { startDate: string }) => b.startDate)).toEqual([
      "2026-11-10",
    ]);
    expect((await listed("")).body.total).toBe(4);
    expect(lakeOnly.body.items[2]).toMatchObject({ origin: "google", readOnly: true });
    expect(lakeOnly.body.items[2]).not.toHaveProperty("externalEventId");
  });

  it("rejects an invalid query", async () => {
    expect((await listed("from=2026-11-05&to=2026-11-01")).status).toBe(422);
    expect((await listed("propertyId=x")).status).toBe(422);
    expect((await listed("pageSize=501")).status).toBe(422);
  });

  it("reads one block, or 404", async () => {
    const { body } = await post({ startDate: "2026-11-01", endDate: "2026-11-02" });
    expect(await (await getOne(new Request(BASE), context(body.id))).json()).toEqual(body);
    expect((await getOne(new Request(BASE), context(crypto.randomUUID()))).status).toBe(404);
    expect((await getOne(new Request(BASE), context("x"))).status).toBe(404);
  });
});

describe("update", () => {
  it("moves a block, checking the new dates against confirmed bookings", async () => {
    const { body: block } = await post({ startDate: "2026-11-01", endDate: "2026-11-03" });
    const stay = await booking("2026-11-10", "2026-11-12");

    const moved = await patch(block.id, {
      startDate: "2026-11-05",
      endDate: "2026-11-08",
      reason: null,
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      startDate: "2026-11-05",
      endDate: "2026-11-08",
      reason: null,
    });

    const clash = await patch(block.id, { endDate: "2026-11-11" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.conflicts).toEqual([
      { kind: "booking", id: stay.id, start: "2026-11-10", end: "2026-11-12" },
    ]);

    // One end judged against the stored other end.
    const inverted = await patch(block.id, { startDate: "2026-11-09" });
    expect(inverted.body.error.fields.startDate).toEqual(["must be after the start date"]);

    // Only the reason: no date check, so a booking added meanwhile does not stand in the way.
    expect((await patch(block.id, { reason: "Roof" })).body.reason).toBe("Roof");
  });

  it("rejects an empty or unknown update, and 404s a missing block", async () => {
    const { body: block } = await post({ startDate: "2026-11-01", endDate: "2026-11-03" });
    expect((await patch(block.id, {})).status).toBe(422);
    expect((await patch(block.id, { propertyId: sea })).status).toBe(422);
    expect((await patch(crypto.randomUUID(), { reason: "x" })).status).toBe(404);
  });
});

describe("delete", () => {
  it("deletes a manual block outright, freeing its dates", async () => {
    const { body: block } = await post({ startDate: "2026-11-01", endDate: "2026-11-03" });
    expect((await DELETE(new Request(BASE), context(block.id))).status).toBe(204);
    expect(await db.block.count()).toBe(0);
    expect((await getAvailability(lake, "2026-11-01", "2026-11-03")).map((d) => d.status)).toEqual([
      "available",
      "available",
    ]);
    expect((await DELETE(new Request(BASE), context(block.id))).status).toBe(404);
  });
});

describe("blocks from Google Calendar", () => {
  it("cannot be changed or deleted through the API", async () => {
    const block = await googleBlock();
    const edit = await patch(block.id, { reason: "Mine now" });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toMatchObject({ code: "conflict", reason: "google" });
    expect(edit.body.error.message).toMatch(/Google Calendar/);

    const removal = await DELETE(new Request(BASE), context(block.id));
    expect(removal.status).toBe(409);
    expect((await removal.json()).error.reason).toBe("google");

    expect(await db.block.findUniqueOrThrow({ where: { id: block.id } })).toMatchObject({
      reason: "Family Christmas",
      startDate: block.startDate,
    });
  });
});
