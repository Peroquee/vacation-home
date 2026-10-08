import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { findOverlappingBlocks } from "@/lib/blocks/service";
import { fromUtcDate, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

let propertyId: string;
let otherPropertyId: string;

const newProperty = (name: string) =>
  db.property.create({ data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e" } });

function block(
  start: string,
  end: string,
  overrides: Partial<Prisma.BlockUncheckedCreateInput> = {},
) {
  return db.block.create({
    data: { propertyId, startDate: toUtcDate(start), endDate: toUtcDate(end), ...overrides },
  });
}

beforeAll(async () => {
  propertyId = (await newProperty("Lake House")).id;
  otherPropertyId = (await newProperty("Sea View")).id;
});

beforeEach(async () => {
  await db.block.deleteMany();
});

afterAll(async () => {
  await db.block.deleteMany();
  await db.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
  await db.$disconnect();
});

describe("overlapping blocks", () => {
  it("make the dates they cover unavailable, and only those", async () => {
    await block("2026-07-14", "2026-07-18", { reason: "Painting" });
    const overlapping = async (start: string, end: string) =>
      (await findOverlappingBlocks(propertyId, { start, end })).map((b) => b.reason);

    expect(await overlapping("2026-07-10", "2026-07-15")).toEqual(["Painting"]);
    expect(await overlapping("2026-07-17", "2026-07-20")).toEqual(["Painting"]);
    expect(await overlapping("2026-07-15", "2026-07-16")).toEqual(["Painting"]);
    expect(await overlapping("2026-07-01", "2026-07-31")).toEqual(["Painting"]);
    // Touching is not overlapping: arrive the day the block ends, or leave the
    // day it starts.
    expect(await overlapping("2026-07-18", "2026-07-21")).toEqual([]);
    expect(await overlapping("2026-07-10", "2026-07-14")).toEqual([]);
  });

  it("refuse an empty or inverted range instead of reporting it free", async () => {
    await expect(
      findOverlappingBlocks(propertyId, { start: "2026-07-18", end: "2026-07-14" }),
    ).rejects.toThrow(RangeError);
    await expect(
      findOverlappingBlocks(propertyId, { start: "2026-07-14", end: "2026-07-14" }),
    ).rejects.toThrow(RangeError);
  });

  it("belong to their own property only", async () => {
    await block("2026-07-14", "2026-07-18");
    expect(
      await findOverlappingBlocks(otherPropertyId, { start: "2026-07-14", end: "2026-07-18" }),
    ).toEqual([]);
  });

  it("are returned in date order, imported and manual alike", async () => {
    await block("2026-07-20", "2026-07-22", { reason: "Later" });
    await block("2026-07-14", "2026-07-16", {
      reason: "Imported",
      origin: "google",
      externalEventId: "evt_1",
    });
    const found = await findOverlappingBlocks(propertyId, {
      start: "2026-07-01",
      end: "2026-08-01",
    });
    expect(found.map((b) => [b.reason, b.origin])).toEqual([
      ["Imported", "google"],
      ["Later", "manual"],
    ]);
    expect(fromUtcDate(found[0]!.endDate)).toBe("2026-07-16");
  });
});

describe("block constraints", () => {
  it("refuse an end that is not after the start", async () => {
    await expect(block("2026-07-14", "2026-07-14")).rejects.toThrow(/blocks_end_after_start/);
  });

  it("tie the external event id to the origin", async () => {
    await expect(block("2026-07-14", "2026-07-15", { origin: "google" })).rejects.toThrow(
      /blocks_external_event_matches_origin/,
    );
    await expect(
      block("2026-07-14", "2026-07-15", { origin: "manual", externalEventId: "evt_1" }),
    ).rejects.toThrow(/blocks_external_event_matches_origin/);
  });

  it("refuse a blank event id", async () => {
    await expect(
      block("2026-07-14", "2026-07-15", { origin: "google", externalEventId: " " }),
    ).rejects.toThrow(/blocks_external_event_not_blank/);
  });

  it("allow one block per Google event per property", async () => {
    const imported = { origin: "google" as const, externalEventId: "evt_1" };
    await block("2026-07-14", "2026-07-15", imported);
    await expect(block("2026-08-01", "2026-08-02", imported)).rejects.toMatchObject({
      code: "P2002",
    });
    // The same event may be imported for another property's calendar.
    await expect(
      block("2026-07-14", "2026-07-15", { ...imported, propertyId: otherPropertyId }),
    ).resolves.toBeDefined();
  });

  it("go with their property when it is deleted", async () => {
    const doomed = await newProperty("Doomed");
    await block("2026-07-14", "2026-07-15", { propertyId: doomed.id });
    await db.property.delete({ where: { id: doomed.id } });
    expect(await db.block.count({ where: { propertyId: doomed.id } })).toBe(0);
  });
});
