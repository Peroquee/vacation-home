/**
 * Receipts on transactions (GitLab #82), and documents on recurring costs
 * such as the loan agreement or the insurance policy (GitLab #130): the
 * same files, checks and rows, owned by one or the other. Server-side only.
 *
 * - **Files** live in the content-addressed store (src/lib/files/store.ts),
 *   shared with listing photos: the same receipt uploaded twice is one
 *   file. The database holds which transaction has which file, under what
 *   name and type.
 * - **Checked on the way in**: the type from the file's own bytes (PDF, JPEG,
 *   PNG, WebP, HEIC), 10 MB, five per transaction and twenty per rule. A JPEG loses its metadata
 *   (EXIF with the GPS position, XMP, IPTC); HEIC and WebP are kept as they
 *   are, and the upload says so.
 * - **Thumbnails** are small JPEGs the browser makes from images; PDFs and
 *   HEIC have none.
 * - **Deleting** a receipt, its transaction or its rule removes the rows; a file
 *   nothing points to any more goes at once, or with the daily cleanup.
 * - **Accounting records**: erasing a guest's personal data does not touch
 *   receipts (DSGVO Art. 17(3)(b); kept 8 years under §147 AO).
 */
import type { TransactionAttachment } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  readStoredFile,
  removeIfUnreferenced,
  removeOrphanFiles,
  storedFilePath,
  storeFile,
} from "@/lib/files/store";

import {
  cleanFileName,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  MAX_RULE_DOCUMENTS,
  MAX_THUMBNAIL_BYTES,
  sniffType,
  stripJpegMetadata,
} from "./receipt-files";

/** Where a receipt's file is: see src/lib/files/store.ts. */
export const receiptPath = storedFilePath;
export const readReceiptFile = readStoredFile;
/** The daily sweep of unused files, receipts and photos alike. */
export { removeOrphanFiles };

export function toReceiptDto(attachment: TransactionAttachment) {
  return {
    id: attachment.id,
    transactionId: attachment.transactionId,
    recurringExpenseId: attachment.recurringExpenseId,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    size: attachment.size,
    hasThumbnail: attachment.thumbnailSha256 !== null,
    createdAt: attachment.createdAt.toISOString(),
  };
}
export type ReceiptDto = ReturnType<typeof toReceiptDto>;

/** What a file belongs to: a transaction, or a recurring cost (GitLab #130). */
export type ReceiptOwner = { transactionId: string } | { recurringExpenseId: string };

export function listReceipts(owner: ReceiptOwner | string) {
  return db.transactionAttachment.findMany({
    where: typeof owner === "string" ? { transactionId: owner } : owner,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export type AddReceipt =
  | { attachment: TransactionAttachment }
  | { error: "not_found" }
  | { error: "invalid"; field: "file" | "thumbnail"; message: string }
  | { error: "too_many" };

/** Checks and stores a receipt on a transaction, or a document on a rule. */
export async function addReceipt(
  to: ReceiptOwner | string,
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

  const owner: ReceiptOwner = typeof to === "string" ? { transactionId: to } : to;
  const exists =
    "transactionId" in owner
      ? await db.transaction.findUnique({
          where: { id: owner.transactionId },
          select: { id: true },
        })
      : await db.recurringExpense.findUnique({
          where: { id: owner.recurringExpenseId },
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
    // One upload at a time per owner, so the limit holds.
    if ("transactionId" in owner) {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${owner.transactionId}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM recurring_expenses WHERE id = ${owner.recurringExpenseId}::uuid FOR UPDATE`;
    }
    const count = await tx.transactionAttachment.count({ where: owner });
    const max = "transactionId" in owner ? MAX_RECEIPTS : MAX_RULE_DOCUMENTS;
    if (count >= max) return { error: "too_many" } as const;
    const attachment = await tx.transactionAttachment.create({
      data: {
        ...owner,
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
  await removeIfUnreferenced([attachment.sha256, attachment.thumbnailSha256]);
  return true;
}
