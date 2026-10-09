import { isUuid, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteReceipt, readReceiptFile } from "@/lib/finance/receipts";

type Context = RouteContext<"/api/attachments/[id]">;

/** Types a browser may show in a tab; everything else is a download. */
const INLINE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * A receipt's file, for signed-in users only (src/proxy.ts); there is no
 * public URL. Images open in the browser (`?download=1` saves them);
 * PDFs and HEIC always download, so no uploaded document runs in this
 * site's origin.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Receipt");
  const attachment = await db.transactionAttachment.findUnique({ where: { id } });
  if (!attachment) return notFound("Receipt");
  let bytes: Buffer;
  try {
    bytes = await readReceiptFile(attachment.sha256);
  } catch {
    return notFound("Receipt");
  }
  const download =
    !INLINE.has(attachment.mediaType) || new URL(request.url).searchParams.has("download");
  const name = encodeURIComponent(attachment.fileName);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Removes a receipt (204); its file goes once nothing else uses it. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await deleteReceipt(id))) return notFound("Receipt");
  return new Response(null, { status: 204 });
}
