import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { todayIn } from "@/lib/today";
import { fillLegal } from "@/lib/legal/testing/complete-legal";
import { readStoredFile } from "@/lib/files/store";

import { getPublicProperty, listPublicProperties } from "./public";
import { listingSchema } from "./schema";
import {
  addPhoto,
  deletePhoto,
  getListing,
  listPhotos,
  photoFileOf,
  reorderPhotos,
  saveListing,
  updatePhoto,
} from "./service";

let propertyId: string;
let otherId: string;

const jpeg = (shade: number) =>
  sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: shade, g: 40, b: 90 } },
  })
    .jpeg()
    .withExif({ IFD0: { ImageDescription: "Secret Street 1" } })
    .toBuffer();

async function upload(shade: number) {
  const result = await addPhoto(propertyId, await jpeg(shade));
  if (!("photo" in result)) throw new Error(JSON.stringify(result));
  return result.photo;
}

beforeAll(async () => {
  await fillLegal();
  const create = (name: string, slug: string) =>
    db.property.create({
      data: {
        name,
        address: "Secret Street 1, 12345 Hiddenville",
        timezone: "UTC",
        currency: "EUR",
        color: "#0f766e",
        defaultNightlyRateMinor: 15_000,
        slug,
        publiclyListed: true,
      },
    });
  propertyId = (await create("Lake House", "lake-house")).id;
  otherId = (await create("Sea View", "sea-view")).id;
});

beforeEach(async () => {
  await db.propertyPhoto.deleteMany();
  await db.propertyListing.deleteMany();
});

afterAll(async () => {
  await db.propertyPhoto.deleteMany();
  await db.propertyListing.deleteMany();
  await db.property.deleteMany();
  await db.$disconnect();
});

describe("the listing profile", () => {
  it("is blank until saved, then holds both languages", async () => {
    expect((await getListing(propertyId)).titleEn).toBe("");
    const input = listingSchema.parse({
      titleEn: "Lake house with a view",
      titleDe: "Seehaus mit Blick",
      location: "Malcesine, Lake Garda",
      maxGuests: 4,
      amenities: ["wifi", "bbq", "wifi"],
    });
    const saved = await saveListing(propertyId, input);
    expect(saved).toMatchObject({
      titleDe: "Seehaus mit Blick",
      amenities: ["bbq", "wifi"],
    });
  });

  it("is held to its bounds by the database too", async () => {
    await expect(
      db.propertyListing.create({ data: { propertyId, checkInTime: "25:00" } }),
    ).rejects.toThrow(/property_listings_times/);
    await expect(db.propertyListing.create({ data: { propertyId, maxGuests: 0 } })).rejects.toThrow(
      /property_listings_counts/,
    );
  });
});

describe("photos", () => {
  it("are stored as metadata-free sizes, in order, the first the cover", async () => {
    const first = await upload(10);
    const second = await upload(20);
    expect(first.sizes.map((s) => s.width)).toEqual([480, 960, 1200]);
    expect((await listPhotos(propertyId)).map((p) => p.id)).toEqual([first.id, second.id]);
    for (const size of first.sizes) {
      const sha = size.file.replace(".webp", "");
      const bytes = await readStoredFile(sha);
      expect(bytes.includes("Secret Street")).toBe(false);
      expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    }

    const reordered = await reorderPhotos(propertyId, [second.id, first.id]);
    expect(reordered !== "mismatch" && reordered.map((p) => p.id)).toEqual([second.id, first.id]);
    // A stale or partial list is refused whole.
    expect(await reorderPhotos(propertyId, [first.id])).toBe("mismatch");
    expect(await reorderPhotos(propertyId, [first.id, first.id])).toBe("mismatch");

    expect(await updatePhoto(propertyId, first.id, { altEn: "The terrace" })).toMatchObject({
      altEn: "The terrace",
    });
    // Another property's photo is not this one's.
    expect(await updatePhoto(otherId, first.id, { altEn: "x" })).toBeNull();
    expect(await deletePhoto(otherId, first.id)).toBe(false);
  });

  it("serve only their own files", async () => {
    const photo = await upload(30);
    const file = photo.sizes[0]!.file;
    expect(await photoFileOf(propertyId, file)).toBe(file.replace(".webp", ""));
    expect(await photoFileOf(otherId, file)).toBeNull();
    expect(await photoFileOf(propertyId, "../../etc/passwd")).toBeNull();
    expect(await photoFileOf(propertyId, `${"0".repeat(64)}.webp`)).toBeNull();
  });
});

describe("the public face", () => {
  it("shows the profile and photos, never the address, arrival notes or internal name", async () => {
    await saveListing(
      propertyId,
      listingSchema.parse({
        titleEn: "Lake house with a view",
        location: "Lake Garda",
        exactAddress: "Uferweg 7, 37000 Seedorf",
        arrivalNotes: "Key box code 4711",
      }),
    );
    await upload(40);
    const property = await getPublicProperty("lake-house");
    expect(property).toMatchObject({
      slug: "lake-house",
      title: { en: "Lake house with a view", de: "" },
      location: "Lake Garda",
      nightlyRateFromMinor: 15_000,
    });
    expect(property!.photos[0]!.sizes[0]!.url).toMatch(
      /^\/api\/public\/properties\/lake-house\/photos\/[0-9a-f]{64}\.webp$/,
    );
    const json = JSON.stringify(property);
    expect(json).not.toMatch(/Secret Street|Hiddenville|Lake House"|Uferweg|Seedorf|4711/);
    expect(json).not.toContain(propertyId);
  });

  it("falls back to the property's name when there is no title yet", async () => {
    expect((await getPublicProperty("lake-house"))?.title).toEqual({ en: "Lake House", de: "" });
  });

  it("says what day it is where the property is, for the calendar's first month (GitLab #139)", async () => {
    // 25 hours apart: never the same date.
    for (const timezone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      await db.property.update({ where: { id: propertyId }, data: { timezone } });
      expect((await getPublicProperty("lake-house"))?.today).toBe(todayIn(timezone));
    }
  });

  it("lists every listed, active property for the start page, oldest first", async () => {
    const extra = (name: string, slug: string, data: object) =>
      db.property.create({
        data: { name, timezone: "UTC", currency: "EUR", color: "#0f766e", slug, ...data },
      });
    const hidden = await extra("Hidden", "hidden-hut", { publiclyListed: false });
    const archived = await extra("Archived", "old-barn", {
      publiclyListed: true,
      archivedAt: new Date(),
    });
    try {
      const listed = await listPublicProperties();
      expect(listed.map((p) => p.slug)).toEqual(["lake-house", "sea-view"]);
      expect(JSON.stringify(listed)).not.toMatch(/Secret Street|Hiddenville/);
    } finally {
      await db.property.update({ where: { id: archived.id }, data: { publiclyListed: false } });
      await db.property.deleteMany({ where: { id: { in: [hidden.id, archived.id] } } });
    }
  });
});
