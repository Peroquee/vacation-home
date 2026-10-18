/**
 * The booking API, called through its route handlers against a real
 * PostgreSQL: overlap rejection is tested here at the API level, as the
 * issue requires, not only in the availability service.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as cancel } from "@/app/api/bookings/[id]/cancel/route";
import { GET as getOne, PATCH } from "@/app/api/bookings/[id]/route";
import { GET as list, POST as create } from "@/app/api/bookings/route";
import { DELETE as deleteGuest } from "@/app/api/guests/[id]/route";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

const BASE = "http://localhost/api/bookings";
let lake: { id: string };
let sea: { id: string };
let archived: { id: string };
let ada: { id: string };
let grace: { id: string };

const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function post(body: Record<string, unknown>) {
  const response = await create(
    new Request(BASE, send("POST", { propertyId: lake.id, guestId: ada.id, ...body })),
  );
  return { status: response.status, body: await response.json(), response };
}
async function patch(id: string, body: Record<string, unknown>) {
  const response = await PATCH(new Request(BASE, send("PATCH", body)), context(id));
  return { status: response.status, body: await response.json() };
}
async function confirmed(checkIn: string, checkOut: string, extra: Record<string, unknown> = {}) {
  const { status, body } = await post({ checkIn, checkOut, status: "confirmed", ...extra });
  expect(status).toBe(201);
  return body;
}
async function listing(query: string) {
  return (await list(new Request(`${BASE}?${query}`))).json();
}

beforeAll(async () => {
  const property = (name: string, extra = {}) =>
    db.property.create({
      data: {
        name,
        timezone: "Europe/Lisbon",
        currency: "EUR",
        color: "#0f766e",
        defaultNightlyRateMinor: 12_000,
        defaultCleaningFeeMinor: 4_500,
        ...extra,
      },
    });
  lake = await property("Lake House");
  sea = await property("Sea View", { currency: "CHF" });
  archived = await property("Old Barn", { archivedAt: new Date() });
  ada = await db.guest.create({ data: { name: "Ada Lovelace", email: "ada@example.com" } });
  grace = await db.guest.create({ data: { name: "Grace Hopper", email: "grace@navy.example" } });
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany({ where: { id: { in: [ada.id, grace.id] } } });
  await db.property.deleteMany({ where: { id: { in: [lake.id, sea.id, archived.id] } } });
  await db.$disconnect();
});

describe("POST /api/bookings", () => {
  it("refuses the website as a source: only the public site's requests have it", async () => {
    const { status, body } = await post({
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      source: "website",
    });
    expect(status).toBe(422);
    expect(body.error.fields).toEqual({ source: ["is set by the public booking site only"] });
    expect(await db.booking.count()).toBe(0);
  });

  it("creates a booking with the property's rates and currency and a calculated total", async () => {
    const { status, body, response } = await post({
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
    });

    expect(status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/bookings/${body.id}`);
    expect(body).toMatchObject({
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      nights: 4,
      status: "inquiry",
      source: "direct",
      guestCount: 1,
      // No rate of its own: the property's seasons and standard rate (GitLab #118).
      nightlyRateMinor: null,
      cleaningFeeMinor: 4_500,
      totalAmountMinor: 4 * 12_000 + 4_500,
      totalIsManual: false,
      priceBreakdown: {
        kind: "computed",
        nights: [{ season: null, nights: 4, rateMinor: 12_000, amountMinor: 48_000 }],
        totalMinor: 4 * 12_000 + 4_500,
      },
      currency: "EUR",
      property: { id: lake.id, name: "Lake House" },
      guest: { id: ada.id, name: "Ada Lovelace" },
    });
  });

  it("takes given rates, a hand-set total and the property's own currency", async () => {
    const { body } = await post({
      propertyId: sea.id,
      checkIn: "2026-07-14",
      checkOut: "2026-07-16",
      nightlyRateMinor: 20_000,
      cleaningFeeMinor: 0,
      totalAmountMinor: 35_000,
      source: "booking.com",
    });
    expect(body).toMatchObject({
      currency: "CHF",
      nightlyRateMinor: 20_000,
      totalAmountMinor: 35_000,
      totalIsManual: true,
      source: "booking.com",
    });
  });

  it("rejects invalid input with a 422 per field", async () => {
    const bad = await post({
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      guestCount: 0,
      status: "maybe",
      nightlyRateMinor: 1.5,
      extra: true,
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual([
      "_",
      "guestCount",
      "nightlyRateMinor",
      "status",
    ]);

    const reversed = await post({ checkIn: "2026-07-18", checkOut: "2026-07-14" });
    expect(reversed.body.error.fields).toEqual({ checkOut: ["must be after check-in"] });
    const tooLong = await post({ checkIn: "2026-01-01", checkOut: "2027-06-01" });
    expect(tooLong.body.error.fields.checkOut).toEqual(["a stay can be at most 365 nights"]);

    const malformed = await post({ checkIn: "2026-7-14", checkOut: "2026-07-18" });
    expect(malformed.body.error.fields.checkIn).toEqual(["must be a date as YYYY-MM-DD"]);
  });

  it("rejects an unknown or archived property and an unknown guest", async () => {
    const stay = { checkIn: "2026-07-14", checkOut: "2026-07-18" };
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await post({ ...stay, propertyId: missing })).body.error.fields).toEqual({
      propertyId: ["does not exist"],
    });
    expect((await post({ ...stay, propertyId: archived.id })).body.error.fields).toEqual({
      propertyId: ["is archived"],
    });
    expect((await post({ ...stay, guestId: missing })).body.error.fields).toEqual({
      guestId: ["does not exist"],
    });
  });
});

describe("overlap rejection at the API", () => {
  it("refuses a confirmed booking over another with a 409 naming it", async () => {
    const first = await confirmed("2026-07-14", "2026-07-18");
    const clash = await post({
      checkIn: "2026-07-16",
      checkOut: "2026-07-20",
      status: "confirmed",
    });

    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("conflict");
    expect(clash.body.error.message).toContain(first.id);
    expect(clash.body.error.conflicts).toEqual([
      { kind: "booking", id: first.id, start: "2026-07-14", end: "2026-07-18" },
    ]);
    expect(await db.booking.count()).toBe(1);
  });

  it("refuses a confirmed booking over a block, naming the block", async () => {
    const works = await db.block.create({
      data: {
        propertyId: lake.id,
        startDate: toUtcDate("2026-07-15"),
        endDate: toUtcDate("2026-07-16"),
        reason: "Roof repair",
      },
    });
    const clash = await post({
      checkIn: "2026-07-14",
      checkOut: "2026-07-18",
      status: "confirmed",
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain("Roof repair");
    expect(clash.body.error.conflicts[0]).toMatchObject({ kind: "block", id: works.id });
  });

  it("allows a same-day turnover, another property, and inquiries", async () => {
    await confirmed("2026-07-14", "2026-07-18");
    expect(
      (await post({ checkIn: "2026-07-18", checkOut: "2026-07-20", status: "confirmed" })).status,
    ).toBe(201);
    expect(
      (await post({ checkIn: "2026-07-10", checkOut: "2026-07-14", status: "confirmed" })).status,
    ).toBe(201);
    expect(
      (
        await post({
          propertyId: sea.id,
          checkIn: "2026-07-14",
          checkOut: "2026-07-18",
          status: "confirmed",
        })
      ).status,
    ).toBe(201);
    expect((await post({ checkIn: "2026-07-14", checkOut: "2026-07-18" })).status).toBe(201);
  });

  it("lets exactly one of two simultaneous requests for the same dates through", async () => {
    const results = await Promise.all([
      post({ checkIn: "2026-07-14", checkOut: "2026-07-18", status: "confirmed" }),
      post({
        checkIn: "2026-07-15",
        checkOut: "2026-07-19",
        status: "confirmed",
        guestId: grace.id,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.booking.count()).toBe(1);
  });
});

describe("PATCH /api/bookings/:id", () => {
  it("re-runs the availability check on new dates, ignoring the booking itself", async () => {
    const stay = await confirmed("2026-07-14", "2026-07-18");
    const other = await confirmed("2026-07-20", "2026-07-25");

    // Overlaps only its own old dates: fine.
    expect((await patch(stay.id, { checkIn: "2026-07-15", checkOut: "2026-07-19" })).status).toBe(
      200,
    );

    const clash = await patch(stay.id, { checkOut: "2026-07-21" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.conflicts.map((c: { id: string }) => c.id)).toEqual([other.id]);

    // The refused change was not applied.
    const unchanged = await (await getOne(new Request(BASE), context(stay.id))).json();
    expect([unchanged.checkIn, unchanged.checkOut]).toEqual(["2026-07-15", "2026-07-19"]);
  });

  it("refuses confirming an inquiry whose dates are taken", async () => {
    await confirmed("2026-07-14", "2026-07-18");
    const { body: inquiry } = await post({ checkIn: "2026-07-17", checkOut: "2026-07-19" });
    expect((await patch(inquiry.id, { status: "confirmed" })).status).toBe(409);
  });

  it("recalculates the total from dates and rates, unless it was set by hand", async () => {
    const { body } = await post({ checkIn: "2026-07-14", checkOut: "2026-07-16" });
    expect(body.totalAmountMinor).toBe(2 * 12_000 + 4_500);

    const longer = await patch(body.id, { checkOut: "2026-07-17", nightlyRateMinor: 10_000 });
    expect(longer.body).toMatchObject({ nights: 3, totalAmountMinor: 3 * 10_000 + 4_500 });

    const manual = await patch(body.id, { totalAmountMinor: 25_000 });
    expect(manual.body).toMatchObject({ totalAmountMinor: 25_000, totalIsManual: true });
    expect((await patch(body.id, { checkOut: "2026-07-20" })).body.totalAmountMinor).toBe(25_000);

    const automatic = await patch(body.id, { totalAmountMinor: null });
    expect(automatic.body).toMatchObject({
      totalAmountMinor: 6 * 10_000 + 4_500,
      totalIsManual: false,
    });
  });

  it("validates a single changed end against the stored one, and other fields", async () => {
    const { body } = await post({ checkIn: "2026-07-14", checkOut: "2026-07-18" });
    expect((await patch(body.id, { checkIn: "2026-07-20" })).body.error.fields).toEqual({
      checkIn: ["must be after check-in"],
    });
    expect((await patch(body.id, { checkOut: "2030-01-01" })).body.error.fields).toEqual({
      checkOut: ["a stay can be at most 365 nights"],
    });
    expect((await patch(body.id, { guestId: "00000000-0000-4000-8000-000000000000" })).status).toBe(
      422,
    );
    expect((await patch(body.id, { propertyId: sea.id })).status).toBe(422);
    expect((await patch("00000000-0000-4000-8000-000000000000", { notes: "x" })).status).toBe(404);
  });
});

describe("concurrent changes to one booking", () => {
  it("never lose a cancellation to a simultaneous edit", async () => {
    for (let round = 0; round < 5; round++) {
      const stay = await confirmed("2026-07-14", "2026-07-18");
      await Promise.all([
        patch(stay.id, { notes: `edit ${round}` }),
        cancel(new Request(BASE), context(stay.id)),
      ]);
      const final = await (await getOne(new Request(BASE), context(stay.id))).json();
      expect(final.status).toBe("cancelled");
      await db.booking.deleteMany();
    }
  });
});

describe("totals that cannot be stored", () => {
  it("are reported on the total, whichever change caused them", async () => {
    const { body } = await post({
      checkIn: "2026-07-14",
      checkOut: "2026-07-15",
      nightlyRateMinor: 100_000_000,
    });
    const longer = await patch(body.id, { checkOut: "2026-08-14" });
    expect(longer.body.error.fields).toEqual({
      totalAmountMinor: ["the calculated total is too large to store"],
    });
  });
});

describe("POST /api/bookings/:id/cancel", () => {
  it("frees the dates, keeps the booking, and can be repeated", async () => {
    const stay = await confirmed("2026-07-14", "2026-07-18");
    const first = await (await cancel(new Request(BASE), context(stay.id))).json();
    expect(first.status).toBe("cancelled");
    expect((await cancel(new Request(BASE), context(stay.id))).status).toBe(200);

    expect(
      (await post({ checkIn: "2026-07-14", checkOut: "2026-07-18", status: "confirmed" })).status,
    ).toBe(201);
    expect(await db.booking.count()).toBe(2);
  });

  it("returns 404 for an unknown booking", async () => {
    expect(
      (await cancel(new Request(BASE), context("00000000-0000-4000-8000-000000000000"))).status,
    ).toBe(404);
  });
});

describe("GET /api/bookings", () => {
  beforeEach(async () => {
    await confirmed("2026-07-01", "2026-07-05");
    await confirmed("2026-07-10", "2026-07-12", { source: "airbnb" });
    await post({
      checkIn: "2026-07-20",
      checkOut: "2026-07-22",
      guestId: grace.id,
      source: "booking.com",
    });
    await confirmed("2026-07-01", "2026-07-03", { propertyId: sea.id });
  });

  const ids = (page: { items: { checkIn: string; property: { name: string } }[] }) =>
    page.items.map((b) => `${b.property.name.split(" ")[0]} ${b.checkIn}`);

  it("filters by property, status, source, overlapping dates and guest", async () => {
    expect(ids(await listing(`propertyId=${lake.id}`))).toEqual([
      "Lake 2026-07-01",
      "Lake 2026-07-10",
      "Lake 2026-07-20",
    ]);
    expect(ids(await listing(`propertyId=${lake.id}&status=inquiry`))).toEqual(["Lake 2026-07-20"]);
    expect(ids(await listing("source=airbnb,booking.com"))).toEqual([
      "Lake 2026-07-10",
      "Lake 2026-07-20",
    ]);
    // Overlapping [04, 11): the stay ending on the 5th and the one starting on the 10th.
    expect(ids(await listing(`propertyId=${lake.id}&from=2026-07-04&to=2026-07-11`))).toEqual([
      "Lake 2026-07-01",
      "Lake 2026-07-10",
    ]);
    // A stay ending on `from` does not overlap it.
    expect(ids(await listing(`propertyId=${lake.id}&from=2026-07-05&to=2026-07-06`))).toEqual([]);
    expect(ids(await listing("q=HOPPER"))).toEqual(["Lake 2026-07-20"]);
    expect(ids(await listing("q=navy.ex"))).toEqual(["Lake 2026-07-20"]);
  });

  it("treats an empty page or page size as the default", async () => {
    const page = await listing("page=&pageSize=");
    expect([page.page, page.pageSize]).toEqual([1, 25]);
  });

  it("paginates with a total, and sorts either way", async () => {
    const first = await listing("pageSize=3");
    expect([first.total, first.page, first.pageSize, first.items.length]).toEqual([4, 1, 3, 3]);
    const second = await listing("pageSize=3&page=2");
    expect(second.items).toHaveLength(1);
    expect(ids(await listing(`propertyId=${lake.id}&sort=-checkIn`))[0]).toBe("Lake 2026-07-20");
  });

  it("rejects an invalid query", async () => {
    const status = await list(new Request(`${BASE}?status=maybe`));
    expect(status.status).toBe(422);
    expect(Object.keys((await status.json()).error.fields)).toEqual(["status"]);

    const range = await list(new Request(`${BASE}?from=2026-07-10&to=2026-07-01`));
    expect((await range.json()).error.fields).toEqual({ to: ["must be after from"] });
  });
});

describe("deleting what bookings depend on", () => {
  it("refuses deleting a property or guest that has bookings", async () => {
    await confirmed("2026-07-14", "2026-07-18");
    expect((await deleteProperty(new Request(BASE), context(lake.id))).status).toBe(409);
    expect((await deleteGuest(new Request(BASE), context(ada.id))).status).toBe(409);
  });
});
