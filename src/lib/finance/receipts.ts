/**
 * Receipts on transactions (GitLab #82). Server-side only.
 *
 * - **Files** live in RECEIPTS_DIR, named by their SHA-256 under a two-
 *   character folder (`ab/abcdef…`), written atomically and never changed:
 *   the same receipt uploaded twice is one file. The database holds which
 *   transaction has which file, under what name and type.
 * - **Checked on the way in**: the type from the file's own bytes (PDF, JPEG,
 *   PNG, WebP, HEIC), 10 MB, five per transaction. A JPEG loses its metadata
 *   (EXIF with the GPS position, XMP, IPTC); HEIC and WebP are kept as they
 *   are, and the upload says so.
 * - **Thumbnails** are small JPEGs the browser makes from images; PDFs and
 *   HEIC have none.
 * - **Deleting** a receipt or its transaction removes the rows; a file
 *   nothing points to any more goes at once, or with the daily cleanup.
 * - **Accounting records**: erasing a guest's personal data does not touch
 *   receipts (DSGVO Art. 17(3)(b); kept 8 years under §147 AO).
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { env } from "@/env";
import type { TransactionAttachment } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import {
  cleanFileName,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  MAX_THUMBNAIL_BYTES,
  sniffType,
  stripJpegMetadata,
} from "./receipt-files";

const SHA = /^[0-9a-f]{64}$/;

export function receiptPath(sha256: string): string {
  if (!SHA.test(sha256)) throw new Error("not a SHA-256");
  return join(env.RECEIPTS_DIR, sha256.slice(0, 2), sha256);
}

/** Writes the bytes under their hash, unless that file exists. Returns the hash. */
async function storeFile(bytes: Uint8Array): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = receiptPath(sha256);
  try {
    await stat(path);
    return sha256;
  } catch {
    // Not there yet.
  }
  await mkdir(join(env.RECEIPTS_DIR, sha256.slice(0, 2)), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  // Readable by the backup service (another user), writable by the app only.
  await writeFile(temporary, bytes, { mode: 0o644 });
  await rename(temporary, path);
  return sha256;
}

export function readReceiptFile(sha256: string): Promise<Buffer> {
  return readFile(receiptPath(sha256));
}

export function toReceiptDto(attachment: TransactionAttachment) {
  return {
    id: attachment.id,
    transactionId: attachment.transactionId,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    size: attachment.size,
    hasThumbnail: attachment.thumbnailSha256 !== null,
    createdAt: attachment.createdAt.toISOString(),
  };
}
export type ReceiptDto = ReturnType<typeof toReceiptDto>;

export function listReceipts(transactionId: string) {
  return db.transactionAttachment.findMany({
    where: { transactionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export type AddReceipt =
  | { attachment: TransactionAttachment }
  | { error: "not_found" }
  | { error: "invalid"; field: "file" | "thumbnail"; message: string }
  | { error: "too_many" };

/** Checks and stores a receipt on a transaction. */
export async function addReceipt(
  transactionId: string,
  upload: { name: string; bytes: Uint8Array; thumbnail?: Uint8Array | null },
): Promise<AddReceipt> {
  const invalid = (field: "file" | "thumbnail", message: string) =>
    ({ error: "invalid", field, message }) as const;
  if (upload.bytes.length === 0) return invalid("file", "is required");
  if (upload.bytes.length > MAX_RECEIPT_BYTES) return invalid("file", "is larger than 10 MB");
  const type = sniffType(upload.bytes);
  if (!type) return invalid("file", "must be a PDF, JPEG, PNG, WebP or HEIC file");

  let bytes = upload.bytes;
  if (type === "image/jpeg") {
    const stripped = stripJpegMetadata(bytes);
    if (!stripped) return invalid("file", "is not a readable JPEG");
    bytes = stripped;
  }
  const thumbnail = upload.thumbnail && upload.thumbnail.length > 0 ? upload.thumbnail : null;
  if (thumbnail) {
    if (thumbnail.length > MAX_THUMBNAIL_BYTES || sniffType(thumbnail) !== "image/jpeg") {
      return invalid("thumbnail", "must be a small JPEG");
    }
  }

  const exists = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true },
  });
  if (!exists) return { error: "not_found" };

  // Files first: a file without a row is cleaned up later; a row without
  // its file would be a broken receipt.
  const sha256 = await storeFile(bytes);
  const thumbnailSha256 = thumbnail
    ? await storeFile(stripJpegMetadata(thumbnail) ?? thumbnail)
    : null;

  return db.$transaction(async (tx) => {
    // One upload at a time per transaction, so the limit holds.
    await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
    const count = await tx.transactionAttachment.count({ where: { transactionId } });
    if (count >= MAX_RECEIPTS) return { error: "too_many" } as const;
    const attachment = await tx.transactionAttachment.create({
      data: {
        transactionId,
        fileName: cleanFileName(upload.name),
        mediaType: type,
        size: bytes.length,
        sha256,
        thumbnailSha256,
      },
    });
    return { attachment };
  });
}

/** Removes a receipt, and its files when nothing else uses them. */
export async function deleteReceipt(id: string): Promise<boolean> {
  const attachment = await db.transactionAttachment.findUnique({ where: { id } });
  if (!attachment) return false;
  await db.transactionAttachment.delete({ where: { id } });
  for (const sha of [attachment.sha256, attachment.thumbnailSha256]) {
    if (sha && !(await isReferenced(sha))) await rm(receiptPath(sha), { force: true });
  }
  return true;
}

async function isReferenced(sha256: string): Promise<boolean> {
  const count = await db.transactionAttachment.count({
    where: { OR: [{ sha256 }, { thumbnailSha256: sha256 }] },
  });
  return count > 0;
}

/**
 * Deletes files no receipt points to: left by deleted transactions, or by
 * an upload that failed after its file was written. Files younger than
 * `graceMs` stay, so an upload in progress is never caught.
 */
export async function removeOrphanFiles({
  now = new Date(),
  graceMs = 60 * 60_000,
}: { now?: Date; graceMs?: number } = {}): Promise<{ removed: number; kept: number }> {
  const result = { removed: 0, kept: 0 };
  let folders: string[];
  try {
    folders = await readdir(env.RECEIPTS_DIR);
  } catch {
    return result;
  }
  const rows = await db.transactionAttachment.findMany({
    select: { sha256: true, thumbnailSha256: true },
  });
  const referenced = new Set(rows.flatMap((r) => [r.sha256, r.thumbnailSha256]).filter(Boolean));
  for (const folder of folders) {
    if (!/^[0-9a-f]{2}$/.test(folder)) continue;
    for (const name of await readdir(join(env.RECEIPTS_DIR, folder))) {
      const path = join(env.RECEIPTS_DIR, folder, name);
      if (referenced.has(name)) {
        result.kept++;
        continue;
      }
      const { mtime } = await stat(path);
      if (now.getTime() - mtime.getTime() < graceMs) continue;
      await rm(path, { force: true });
      result.removed++;
    }
  }
  if (result.removed > 0) logger.info(result, "orphaned receipt files removed");
  return result;
}
