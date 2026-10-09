import { isUuid, notFound, parseBody } from "@/lib/api";
import { blockWriteResponse, readOnlyBlock } from "@/lib/blocks/responses";
import { updateBlockSchema } from "@/lib/blocks/schema";
import { deleteBlock, getBlock, toDto, updateBlock } from "@/lib/blocks/writes";

type Context = RouteContext<"/api/blocks/[id]">;

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const block = isUuid(id) ? await getBlock(id) : null;
  return block ? Response.json(toDto(block)) : notFound("Block");
}

/**
 * Updates the dates or reason of a manual block; new dates are checked
 * against confirmed bookings (409 if taken). Blocks from Google Calendar
 * are refused with 409 and `reason: "google"`.
 */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Block");
  const body = await parseBody(request, updateBlockSchema);
  if ("response" in body) return body.response;
  return blockWriteResponse(await updateBlock(id, body.data));
}

/** Deletes a manual block (204). Imported blocks: 409, `reason: "google"` or `"ical"`. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Block");
  const result = await deleteBlock(id);
  if ("deleted" in result) return new Response(null, { status: 204 });
  return result.error === "read_only" ? readOnlyBlock(result.origin) : notFound("Block");
}
