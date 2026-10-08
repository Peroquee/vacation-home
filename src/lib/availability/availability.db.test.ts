import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import {
  getAvailability,
  isAvailable,
  isOverlapViolation,
  withPropertyLock,
} from "@/lib/availability/service";
import { toUtcDate } from "@/lib/calendar-date";
import { db, type DbClient } from "@/lib/db";

let lake: string;
let sea: string;
let guestId: string;

const property = (name: string) =>
  db.property.create({ data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e" } });

function booking(
  checkIn: string,
  checkOut: string,
  overrides: Partial<Prisma.BookingUncheckedCreateInput> = {},
  client: DbClient = db,
) {
  return client.booking.create({
    data: {
      propertyId: lake,
      guestId,
      checkIn: toUtcDate(checkIn),
      checkOut: toUtcDate(checkOut),
      status: "confirmed",
      nightlyRateMinor: 10_000,
      cleaningFeeMinor: 0,
      totalAmountMinor: 0,
      currency: "EUR",
      ...overrides,
    },
  });
}

function block(start: string, end: string, client: DbClient = db) {
  return client.block.create({
    data: {
      propertyId: lake,
      startDate: toUtcDate(start),
      endDate: toUtcDate(end),
      reason: "Works",
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  lake = (await property("Lake House")).id;
  sea = (await property("Sea View")).id;
  guestId = (await db.guest.create({ data: { name: "Ada" } })).id;
});

beforeEach(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
});

afterAll(async () => {
  await db.booking.deleteMany();
  await db.block.deleteMany();
  await db.guest.deleteMany({ where: { id: guestId } });
  await db.property.deleteMany({ where: { id: { in: [lake, sea] } } });
  await db.$disconnect();
});

describe("the database's overlap constraint", () => {
  it("refuses a second confirmed booking for overlapping nights of the same property", async () => {
    await booking("2026-07-14", "2026-07-18");
    const error = await booking("2026-07-17", "2026-07-20").catch((e: unknown) => e);
    expect(isOverlapViolation(error)).toBe(true);
  });

  it("allows the same dates at a different property", async () => {
    await booking("2026-07-14", "2026-07-18");
    await expect(booking("2026-07-14", "2026-07-18", { propertyId: sea })).resolves.toBeDefined();
  });

  it("allows a same-day turnover", async () => {
    await booking("2026-07-14", "2026-07-18");
    await expect(booking("2026-07-18", "2026-07-20")).resolves.toBeDefined();
    await expect(booking("2026-07-10", "2026-07-14")).resolves.toBeDefined();
  });

  it("ignores inquiries and cancelled bookings", async () => {
    await booking("2026-07-14", "2026-07-18");
    await expect(booking("2026-07-14", "2026-07-18", { status: "inquiry" })).resolves.toBeDefined();
    await expect(
      booking("2026-07-14", "2026-07-18", { status: "cancelled" }),
    ).resolves.toBeDefined();
  });

  it("refuses confirming an inquiry whose dates are taken", async () => {
    await booking("2026-07-14", "2026-07-18");
    const inquiry = await booking("2026-07-16", "2026-07-19", { status: "inquiry" });
    const error = await db.booking
      .update({ where: { id: inquiry.id }, data: { status: "confirmed" } })
      .catch((e: unknown) => e);
    expect(isOverlapViolation(error)).toBe(true);
  });

  it("lets exactly one of two simultaneous overlapping bookings through", async () => {
    const results = await Promise.allSettled([
      booking("2026-07-14", "2026-07-18"),
      booking("2026-07-16", "2026-07-20"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [rejected] = results.filter((r) => r.status === "rejected");
    expect(isOverlapViolation((rejected as PromiseRejectedResult).reason)).toBe(true);
    expect(await db.booking.count()).toBe(1);
  });

  it("is not mistaken for other errors", async () => {
    const error = await booking("2026-07-14", "2026-07-14").catch((e: unknown) => e);
    expect(isOverlapViolation(error)).toBe(false);
  });
});

describe("isAvailable", () => {
  it("reports confirmed bookings and blocks in the way, ignoring the rest", async () => {
    const confirmed = await booking("2026-07-14", "2026-07-18");
    await booking("2026-07-20", "2026-07-22", { status: "inquiry" });
    await booking("2026-07-22", "2026-07-24", { status: "cancelled" });
    const works = await block("2026-07-25", "2026-07-27");

    const result = await isAvailable(lake, "2026-07-10", "2026-07-30");
    expect(result.available).toBe(false);
    expect(result.conflicts.map((c) => [c.kind, c.id])).toEqual([
      ["booking", confirmed.id],
      ["block", works.id],
    ]);
    expect(result.conflicts[1]).toMatchObject({
      start: "2026-07-25",
      end: "2026-07-27",
      reason: "Works",
    });

    expect(await isAvailable(lake, "2026-07-18", "2026-07-25")).toEqual({
      available: true,
      conflicts: [],
    });
  });

  it("ignores the booking being moved", async () => {
    const stay = await booking("2026-07-14", "2026-07-18");
    expect((await isAvailable(lake, "2026-07-15", "2026-07-19")).available).toBe(false);
    expect(
      (await isAvailable(lake, "2026-07-15", "2026-07-19", { ignoreBookingId: stay.id })).available,
    ).toBe(true);
  });

  it("only looks at its own property", async () => {
    await booking("2026-07-14", "2026-07-18");
    expect((await isAvailable(sea, "2026-07-14", "2026-07-18")).available).toBe(true);
  });
});

describe("getAvailability", () => {
  it("lays out nights from the database, unshifted by the process timezone (UTC+14)", async () => {
    const stay = await booking("2026-12-30", "2027-01-02");
    await block("2027-01-02", "2027-01-03");

    const days = await getAvailability(lake, "2026-12-29", "2027-01-04");
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ["2026-12-29", "available"],
      ["2026-12-30", "booked"],
      ["2026-12-31", "booked"],
      ["2027-01-01", "booked"],
      ["2027-01-02", "blocked"],
      ["2027-01-03", "available"],
    ]);
    expect(days[1]).toMatchObject({ bookingId: stay.id, checkIn: true });
    expect(days[4]).toMatchObject({ checkOut: true });
  });
});

describe("withPropertyLock", () => {
  /**
   * The check-then-write that blocks need: a block and a booking for the
   * same nights race, each checking availability and then writing, with a
   * pause in between so that without the lock both checks would pass.
   */
  async function race(locked: boolean) {
    const attempt = (write: (tx: DbClient) => Promise<unknown>) => {
      const body = async (tx: DbClient) => {
        const { available } = await isAvailable(lake, "2026-07-14", "2026-07-18", { client: tx });
        if (!available) return "refused";
        await sleep(200);
        await write(tx);
        return "written";
      };
      return locked ? withPropertyLock(lake, body) : body(db);
    };
    return Promise.all([
      attempt((tx) => block("2026-07-15", "2026-07-16", tx)),
      attempt((tx) => booking("2026-07-14", "2026-07-18", {}, tx)),
    ]);
  }

  it("serialises writers, so a block and a booking cannot both take the same nights", async () => {
    const outcomes = await race(true);
    expect(outcomes.sort()).toEqual(["refused", "written"]);
    expect((await db.block.count()) + (await db.booking.count())).toBe(1);
  });

  it("is what prevents it: without the lock, both get through (control)", async () => {
    const outcomes = await race(false);
    expect(outcomes).toEqual(["written", "written"]);
  });

  it("does nothing for a property that does not exist", async () => {
    let ran = false;
    const result = await withPropertyLock("00000000-0000-4000-8000-000000000000", async () => {
      ran = true;
      return "x";
    });
    expect([result, ran]).toEqual([null, false]);
  });
});
