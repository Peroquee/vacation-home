import { isUuid, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { readReceiptFile } from "@/lib/finance/receipts";

/** A receipt's small JPEG preview; 404 for PDFs and HEIC, which have none. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/attachments/[id]/thumbnail">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Receipt");
  const attachment = await db.transactionAttachment.findUnique({ where: { id } });
  if (!attachment?.thumbnailSha256) return notFound("Receipt");
  try {
    const bytes = await readReceiptFile(attachment.thumbnailSha256);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound("Receipt");
  }
}
