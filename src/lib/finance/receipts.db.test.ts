/**
 * Receipts on transactions against a real PostgreSQL and a temporary
 * receipts folder (GitLab #82): upload checks, metadata stripping, the
 * limit, serving, deleting and the orphan cleanup.
 */
import { readdirSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE as deleteReceipt, GET as getReceipt } from "@/app/api/attachments/[id]/route";
import { GET as getThumbnail } from "@/app/api/attachments/[id]/thumbnail/route";
import { GET as listReceipts, POST as upload } from "@/app/api/transactions/[id]/attachments/route";
import { env } from "@/env";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { readReceiptFile, removeOrphanFiles } from "./receipts";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let transactionId: string;

/** A tiny JPEG: start, an EXIF segment with a GPS note, a table, the scan. */
const segment = (marker: number, text: string) => {
  const body = [...text].map((c) => c.charCodeAt(0));
  return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
};
const jpeg = new Uint8Array([
  0xff,
  0xd8,
  ...segment(0xe1, "Exif\0\0GPS 52.52N 13.40E"),
  ...segment(0xdb, "\0".repeat(65)),
  0xff,
  0xda,
  0,
  8,
  1,
  1,
  0,
  0,
  63,
  0,
  0x12,
  0x34,
  0xff,
  0xd9,
]);
const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");

function form(
  file: { name: string; bytes: Uint8Array<ArrayBuffer>; type?: string },
  thumb?: Uint8Array<ArrayBuffer>,
) {
  const data = new FormData();
  data.set(
    "file",
    new File([file.bytes], file.name, { type: file.type ?? "application/octet-stream" }),
  );
  if (thumb) data.set("thumbnail", new File([thumb], "thumbnail.jpg", { type: "image/jpeg" }));
  return new Request("http://test/api", { method: "POST", body: data });
}

beforeEach(async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const property = await db.property.create({
    data: { name: `Lake ${tag}`, timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
  });
  const category = await db.category.create({
    data: { name: `Repairs ${tag}`, type: "expense", color: "#64748b" },
  });
  transactionId = (
    await db.transaction.create({
      data: {
        propertyId: property.id,
        currency: "EUR",
        type: "expense",
        categoryId: category.id,
        amountMinor: 4500,
        date: toUtcDate("2026-07-14"),
      },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("uploading", () => {
  it("stores a photo without its location data, with its thumbnail", async () => {
    const response = await upload(
      form({ name: "C:\\fotos\\Quittung.jpg", bytes: jpeg }, thumbnail),
      ctx(transactionId),
    );
    expect(response.status).toBe(201);
    const receipt = await response.json();
    expect(receipt).toMatchObject({
      fileName: "Quittung.jpg",
      mediaType: "image/jpeg",
      hasThumbnail: true,
    });

    const row = await db.transactionAttachment.findUniqueOrThrow({ where: { id: receipt.id } });
    const stored = await readReceiptFile(row.sha256);
    expect(new TextDecoder().decode(stored)).not.toContain("GPS");
    expect(stored.length).toBeLessThan(jpeg.length);

    const file = await getReceipt(new Request("http://test"), ctx(receipt.id));
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(file.headers.get("content-disposition")).toMatch(
      /^inline; filename\*=UTF-8''Quittung\.jpg$/,
    );
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await getThumbnail(new Request("http://test"), ctx(receipt.id))).status).toBe(200);
  });

  it("goes by the file's bytes, not its name", async () => {
    const fake = await upload(
      form({
        name: "invoice.pdf",
        bytes: new TextEncoder().encode("<html><script>alert(1)</script>"),
        type: "application/pdf",
      }),
      ctx(transactionId),
    );
    expect(fake.status).toBe(422);
    expect((await fake.json()).error.fields.file).toEqual([
      "must be a PDF, JPEG, PNG, WebP or HEIC file",
    ]);

    const real = await (
      await upload(form({ name: "scan", bytes: pdf }), ctx(transactionId))
    ).json();
    expect(real.mediaType).toBe("application/pdf");
    // A PDF never opens in the site's origin: it downloads.
    const file = await getReceipt(new Request("http://test"), ctx(real.id));
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("takes at most five per transaction, and stores identical files once", async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        (await upload(form({ name: `copy ${i}.pdf`, bytes: pdf }), ctx(transactionId))).status,
      ).toBe(201);
    }
    const sixth = await upload(form({ name: "six.pdf", bytes: pdf }), ctx(transactionId));
    expect(sixth.status).toBe(422);
    const rows = await db.transactionAttachment.findMany({ where: { transactionId } });
    expect(new Set(rows.map((r) => r.sha256)).size).toBe(1);
    expect(
      await (await listReceipts(new Request("http://test"), ctx(transactionId))).json(),
    ).toHaveLength(5);
  });

  it("refuses a missing transaction and a missing file", async () => {
    expect(
      (await upload(form({ name: "a.pdf", bytes: pdf }), ctx(crypto.randomUUID()))).status,
    ).toBe(404);
    const empty = new Request("http://test/api", { method: "POST", body: new FormData() });
    expect((await upload(empty, ctx(transactionId))).status).toBe(422);
  });
});

describe("deleting", () => {
  const files = () =>
    readdirSync(env.RECEIPTS_DIR, { recursive: true }).filter((f) => String(f).length > 3);

  it("removes a receipt and its file once nothing uses it", async () => {
    const unique = new TextEncoder().encode(`%PDF-1.7\n% ${crypto.randomUUID()}\n`);
    const first = await (
      await upload(form({ name: "a.pdf", bytes: unique }), ctx(transactionId))
    ).json();
    const second = await (
      await upload(form({ name: "b.pdf", bytes: unique }), ctx(transactionId))
    ).json();
    const { sha256 } = await db.transactionAttachment.findUniqueOrThrow({
      where: { id: first.id },
    });

    expect((await deleteReceipt(new Request("http://test"), ctx(first.id))).status).toBe(204);
    await expect(readReceiptFile(sha256)).resolves.toBeTruthy();
    await deleteReceipt(new Request("http://test"), ctx(second.id));
    await expect(readReceiptFile(sha256)).rejects.toThrow();
  });

  it("drops receipts with their transaction; the cleanup removes the files", async () => {
    const unique = new TextEncoder().encode(`%PDF-1.7\n% ${crypto.randomUUID()}\n`);
    const receipt = await (
      await upload(form({ name: "a.pdf", bytes: unique }), ctx(transactionId))
    ).json();
    const { sha256 } = await db.transactionAttachment.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    await db.transaction.delete({ where: { id: transactionId } });
    expect(await db.transactionAttachment.count({ where: { id: receipt.id } })).toBe(0);

    // Within the grace period an orphan stays: it may be an upload in progress.
    await removeOrphanFiles();
    await expect(readReceiptFile(sha256)).resolves.toBeTruthy();
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    const result = await removeOrphanFiles({ now: later });
    expect(result.removed).toBeGreaterThanOrEqual(1);
    await expect(readReceiptFile(sha256)).rejects.toThrow();
    expect(files().some((f) => String(f).endsWith(sha256))).toBe(false);
  });
});
