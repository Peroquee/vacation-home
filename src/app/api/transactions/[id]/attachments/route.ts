import { apiError, fieldError, isUuid, notFound } from "@/lib/api";
import { MAX_RECEIPT_BYTES, MAX_RECEIPTS } from "@/lib/finance/receipt-files";
import { addReceipt, listReceipts, toReceiptDto } from "@/lib/finance/receipts";

type Context = RouteContext<"/api/transactions/[id]/attachments">;

/** The transaction's receipts (GitLab #82). */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Transaction");
  return Response.json((await listReceipts(id)).map(toReceiptDto));
}

/**
 * Adds a receipt: multipart form data with `file`, and for images an
 * optional `thumbnail` (a small JPEG made by the browser). 201 with the
 * receipt; 422 for a file of the wrong type or size, or a sixth one.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Transaction");
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
  const result = await addReceipt(id, {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    thumbnail: thumbnail instanceof File ? new Uint8Array(await thumbnail.arrayBuffer()) : null,
  });
  if ("attachment" in result) {
    return Response.json(toReceiptDto(result.attachment), { status: 201 });
  }
  if (result.error === "not_found") return notFound("Transaction");
  if (result.error === "too_many") {
    return fieldError("file", `is one too many: at most ${MAX_RECEIPTS} receipts per transaction`);
  }
  return fieldError(result.field, result.message);
}
