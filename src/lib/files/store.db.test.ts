/**
 * The shared file store's sweep against a real PostgreSQL and a temporary
 * folder (GitLab #106): with receipts and listing photos in one store, a
 * file goes only once no row of either kind points to it. A bug here
 * deletes photos or receipts for good, so each case is checked.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { addReceipt, deleteReceipt } from "@/lib/finance/receipts";
import { addPhoto, deletePhoto } from "@/lib/listing/service";

import { readStoredFile, removeOrphanFiles } from "./store";

let propertyId: string;
let transactionId: string;
const LATER = () => new Date(Date.now() + 2 * 60 * 60_000);

/** A JPEG unlike any other, so its files are its own. */
async function uniqueJpeg(): Promise<Uint8Array> {
  const shade = Math.floor(Math.random() * 255);
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: shade, g: 90, b: 160 } },
  })
    .jpeg({ quality: 70 + Math.floor(Math.random() * 25) })
    .toBuffer();
}

async function photo(): Promise<{ id: string; shas: string[] }> {
  const result = await addPhoto(propertyId, await uniqueJpeg());
  if (!("photo" in result)) throw new Error(JSON.stringify(result));
  const sizes = await db.propertyPhotoSize.findMany({ where: { photoId: result.photo.id } });
  return { id: result.photo.id, shas: sizes.map((s) => s.sha256) };
}

const exists = (sha: string) =>
  readStoredFile(sha).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  const property = await db.property.create({
    data: { name: "Lake House", timezone: "UTC", currency: "EUR", color: "#0f766e" },
  });
  propertyId = property.id;
  const category = await db.category.findFirstOrThrow({ where: { type: "expense" } });
  transactionId = (
    await db.transaction.create({
      data: {
        propertyId,
        type: "expense",
        categoryId: category.id,
        amountMinor: 1000,
        currency: "EUR",
        date: toUtcDate("2026-07-01"),
      },
    })
  ).id;
});

beforeEach(async () => {
  await db.propertyPhoto.deleteMany();
  await db.transactionAttachment.deleteMany();
});

afterAll(async () => {
  await db.propertyPhoto.deleteMany();
  await db.transactionAttachment.deleteMany();
  await db.transaction.deleteMany();
  await db.property.deleteMany();
  await db.$disconnect();
});

describe("the file sweep", () => {
  it("keeps a photo's files that only a listing photo points to", async () => {
    const { shas } = await photo();
    expect(shas.length).toBeGreaterThan(0);
    const result = await removeOrphanFiles({ now: LATER() });
    for (const sha of shas) expect(await exists(sha), sha).toBe(true);
    expect(result.kept).toBeGreaterThanOrEqual(shas.length);
  });

  it("deletes a removed photo's files at once, and an orphaned one after the grace period", async () => {
    const removed = await photo();
    expect(await deletePhoto(propertyId, removed.id)).toBe(true);
    for (const sha of removed.shas) expect(await exists(sha)).toBe(false);

    // A photo whose row went without the files (its property deleted in
    // SQL, say): the sweep waits out the grace period, then removes them.
    const orphan = await photo();
    await db.propertyPhoto.delete({ where: { id: orphan.id } });
    await removeOrphanFiles();
    for (const sha of orphan.shas) expect(await exists(sha)).toBe(true);
    await removeOrphanFiles({ now: LATER() });
    for (const sha of orphan.shas) expect(await exists(sha)).toBe(false);
  });

  it("keeps a file shared by a receipt and a photo until both are gone", async () => {
    const shared = await photo();
    const sha = shared.shas[0]!;
    // The same bytes uploaded as a receipt (WebP is kept as it is): one file.
    const receipt = await addReceipt(transactionId, {
      name: "photo.webp",
      bytes: await readStoredFile(sha),
    });
    if (!("attachment" in receipt)) throw new Error(JSON.stringify(receipt));
    expect(receipt.attachment.sha256).toBe(sha);

    // The photo goes: the receipt still needs the file, now and after a sweep.
    await deletePhoto(propertyId, shared.id);
    expect(await exists(sha)).toBe(true);
    await removeOrphanFiles({ now: LATER() });
    expect(await exists(sha)).toBe(true);

    // And the other way round: a photo keeps a file whose receipt went.
    const again = await photo();
    const other = again.shas[0]!;
    const second = await addReceipt(transactionId, {
      name: "again.webp",
      bytes: await readStoredFile(other),
    });
    if (!("attachment" in second)) throw new Error(JSON.stringify(second));
    await deleteReceipt(second.attachment.id);
    expect(await exists(other)).toBe(true);
    await removeOrphanFiles({ now: LATER() });
    expect(await exists(other)).toBe(true);

    // Last reference gone: the file goes.
    await deleteReceipt(receipt.attachment.id);
    expect(await exists(sha)).toBe(false);
  });
});
