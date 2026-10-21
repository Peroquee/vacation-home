import { type APIRequestContext, expect, test } from "@playwright/test";
import sharp from "sharp";

import { withE2eDb } from "./database";

// The listing profile and photos (GitLab #106), on the built server: the
// owner fills in the profile and uploads photos (processed by sharp there),
// and a stranger sees them on the public page - without the address, and
// with no camera or location data in any served image.

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("DELETE FROM property_photos");
    await db.query("DELETE FROM property_listings");
    await db.query("DELETE FROM properties");
  });
});

/** A camera JPEG: its EXIF says where it was taken. */
const cameraJpeg = (shade = 120) =>
  sharp({
    create: { width: 1800, height: 1200, channels: 3, background: { r: shade, g: 150, b: 200 } },
  })
    .jpeg()
    .withExif({
      IFD0: { ImageDescription: "Secretstrasse 1", Make: "PhoneCo" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 8/1 0/1" },
    })
    .toBuffer();

async function listedProperty(request: APIRequestContext) {
  const property = await (
    await request.post("/api/properties", {
      data: {
        name: "Listing Internal Name",
        address: "Secretstrasse 1, 12345 Hiddenville",
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultNightlyRateMinor: 14_000,
        slug: "listing-lake",
        publiclyListed: true,
      },
    })
  ).json();
  return property as { id: string };
}

test("a stranger sees the profile and photos, never the address or the camera's data", async ({
  request,
  browser,
}) => {
  const property = await listedProperty(request);
  const saved = await request.put(`/api/properties/${property.id}/listing`, {
    data: {
      titleEn: "Lake house with a view",
      titleDe: "Seehaus mit Blick",
      descriptionEn: "Wake up to the lake.",
      descriptionDe: "Aufwachen mit Seeblick.",
      houseRulesEn: "No parties.",
      location: "Malcesine, Lake Garda",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 1,
      amenities: ["wifi", "terrace"],
    },
  });
  expect(saved.status()).toBe(200);
  // Arrival and departure have their own card and endpoint (GitLab #126).
  const times = await request.put(`/api/properties/${property.id}/stay-times`, {
    data: { checkInTime: "15:00", earliestCheckOutTime: "08:00", checkOutTime: "10:00" },
  });
  expect(times.status()).toBe(200);
  for (const shade of [100, 200]) {
    const uploaded = await request.post(`/api/properties/${property.id}/photos`, {
      multipart: {
        file: { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await cameraJpeg(shade) },
      },
    });
    expect(uploaded.status()).toBe(201);
    expect((await uploaded.json()).sizes.map((s: { width: number }) => s.width)).toEqual([
      480, 960, 1600,
    ]);
  }

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await stranger.newPage();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
  });
  await page.goto("/stay/listing-lake");
  await expect(
    page.getByRole("heading", { level: 1, name: "Lake house with a view" }),
  ).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Malcesine, Lake Garda");
  await expect(main).toContainText("4 guests · 2 bedrooms · 1 bathroom");
  await expect(main).toContainText("From €140.00 per night");
  await expect(main).toContainText("Wake up to the lake.");
  await expect(main).toContainText("Wi-Fi");
  await expect(main).toContainText("Arrival from 15:00 · Departure between 08:00 and 10:00");
  await expect(main).not.toContainText("Secretstrasse");
  await expect(main).not.toContainText("Hiddenville");
  await expect(main).not.toContainText("Listing Internal Name");

  // Both photos load, the cover first.
  const images = main.getByRole("img");
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveAttribute("fetchpriority", "high");
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }
  expect(violations).toEqual([]);

  // Every served size: WebP, cached for good, and nothing from the camera.
  const body = await (await stranger.request.get("/api/public/properties/listing-lake")).json();
  for (const photo of body.photos) {
    for (const size of photo.sizes) {
      const response = await stranger.request.get(size.url);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/webp");
      expect(response.headers()["cache-control"]).toContain("immutable");
      const bytes = await response.body();
      expect(bytes.includes("Secretstrasse")).toBe(false);
      expect(bytes.includes("PhoneCo")).toBe(false);
      expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    }
  }

  // German visitors read German.
  const german = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    locale: "de-DE",
  });
  const dePage = await german.newPage();
  await dePage.goto("/stay/listing-lake");
  await expect(dePage.getByRole("heading", { level: 1, name: "Seehaus mit Blick" })).toBeVisible();
  // No German rules: the English ones stand in.
  await expect(dePage.getByRole("main")).toContainText("No parties.");
  await german.close();

  // Unlisted: the page and its photos are gone for strangers.
  const url = body.photos[0].sizes[0].url;
  await request.patch(`/api/properties/${property.id}`, { data: { publiclyListed: false } });
  expect((await stranger.request.get(url)).status()).toBe(404);
  expect((await stranger.request.get("/stay/listing-lake")).status()).toBe(404);
  await stranger.close();
});

test("an upload that is not a usable photo is refused with a reason", async ({ request }) => {
  const property = await listedProperty(request);
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic"),
    Buffer.alloc(64),
  ]);
  const refused = await request.post(`/api/properties/${property.id}/photos`, {
    multipart: { file: { name: "IMG_0002.HEIC", mimeType: "image/heic", buffer: heic } },
  });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.fields.file[0]).toMatch(/HEIC photo: choose JPEG/);
  const text = await request.post(`/api/properties/${property.id}/photos`, {
    multipart: {
      file: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    },
  });
  expect((await text.json()).error.fields.file).toEqual(["must be a JPEG, PNG or WebP image"]);
});

test("the owner manages the listing on its settings page", async ({ page, request }) => {
  const property = await listedProperty(request);
  await page.goto("/settings");
  await page
    .getByRole("link", { name: "Edit the public listing of Listing Internal Name" })
    .click();
  await expect(page).toHaveURL(`/settings/properties/${property.id}/listing`);

  // Only types iOS will convert HEIC into, so iPhone photos just work.
  const input = page.locator("#listing-photo-upload");
  await expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await input.setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: await cameraJpeg(30) },
    { name: "b.jpg", mimeType: "image/jpeg", buffer: await cameraJpeg(60) },
  ]);
  const photos = page.getByRole("listitem").filter({ has: page.getByRole("img") });
  await expect(photos).toHaveCount(2);
  await expect(photos.first()).toContainText("Cover");
  await expect(photos.first().getByRole("img", { name: "Cover photo (1 of 2)" })).toBeVisible();
  await expect(photos.nth(1).getByRole("img", { name: "Photo 2 of 2" })).toBeVisible();
  // The thumbnails really load, from the owner's file route under the app's CSP.
  for (const image of await page.getByRole("img", { name: /of 2/ }).all()) {
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }

  // The second becomes the cover.
  await photos.nth(1).getByRole("button", { name: "Make cover" }).click();
  await expect(photos.first().getByRole("button", { name: "Make cover" })).toHaveCount(0);
  await expect(photos.nth(1).getByRole("button", { name: "Make cover" })).toBeVisible();

  await page.getByLabel("Location").fill("Malcesine, Lake Garda");
  await page.getByRole("group", { name: "English" }).getByLabel("Title").fill("Lake house");
  await page.locator("#listing-profile").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Listing saved")).toBeVisible();
  const listing = await (await request.get(`/api/properties/${property.id}/listing`)).json();
  expect(listing).toMatchObject({ titleEn: "Lake house", location: "Malcesine, Lake Garda" });

  // Arrival and departure, in their own card (GitLab #126): the earliest
  // departure may not be after the latest.
  const times = page.locator("#stay-times");
  await times.getByLabel("Earliest arrival").fill("15:00");
  await times.getByLabel("Earliest departure").fill("11:00");
  await times.getByLabel("Latest departure").fill("10:00");
  await times.getByRole("button", { name: "Save", exact: true }).click();
  await expect(times.getByText("must not be later than the latest departure")).toBeVisible();
  await times.getByLabel("Earliest departure").fill("08:00");
  await times.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Arrival and departure times saved")).toBeVisible();
  expect(await (await request.get(`/api/properties/${property.id}/stay-times`)).json()).toEqual({
    checkInTime: "15:00",
    earliestCheckOutTime: "08:00",
    checkOutTime: "10:00",
  });
  // Saving the profile again leaves them alone.
  const resaved = page.waitForResponse(
    (r) => r.url().endsWith("/listing") && r.request().method() === "PUT",
  );
  await page.locator("#listing-profile").getByRole("button", { name: "Save", exact: true }).click();
  expect((await resaved).status()).toBe(200);
  expect(
    (await (await request.get(`/api/properties/${property.id}/stay-times`)).json()).checkInTime,
  ).toBe("15:00");
});
