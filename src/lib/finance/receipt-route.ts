/**
 * The upload and list handlers behind both attachment routes: a
 * transaction's receipts (GitLab #82) and a recurring cost's documents
 * (GitLab #130). Server-side only.
 */
import { apiError, fieldError, notFound } from "@/lib/api";

import { MAX_RECEIPT_BYTES, MAX_RECEIPTS, MAX_RULE_DOCUMENTS } from "./receipt-files";
import { addReceipt, listReceipts, type ReceiptOwner, toReceiptDto } from "./receipts";

const ownerName = (owner: ReceiptOwner) =>
  "transactionId" in owner ? "Transaction" : "Recurring expense";

export async function listResponse(owner: ReceiptOwner): Promise<Response> {
  return Response.json((await listReceipts(owner)).map(toReceiptDto));
}

/**
 * Multipart form data with `file`, and for images an optional `thumbnail`
 * (a small JPEG made by the browser). 201 with the receipt; 422 for a file
 * of the wrong type or size, or one past the limit.
 */
export async function uploadResponse(request: Request, owner: ReceiptOwner): Promise<Response> {
  // Refused before reading: the form is the file plus a little.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_RECEIPT_BYTES + 512 * 1024) return fieldError("file", "is larger than 10 MB");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fieldError("file", "is required");
  const thumbnail = form.get("thumbnail");
  const result = await addReceipt(owner, {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    thumbnail: thumbnail instanceof File ? new Uint8Array(await thumbnail.arrayBuffer()) : null,
  });
  if ("attachment" in result) {
    return Response.json(toReceiptDto(result.attachment), { status: 201 });
  }
  if (result.error === "not_found") return notFound(ownerName(owner));
  if (result.error === "too_many") {
    return "transactionId" in owner
      ? fieldError("file", `is one too many: at most ${MAX_RECEIPTS} receipts per transaction`)
      : fieldError(
          "file",
          `is one too many: at most ${MAX_RULE_DOCUMENTS} documents per recurring expense`,
        );
  }
  return fieldError(result.field, result.message);
}
