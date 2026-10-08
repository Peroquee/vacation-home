import { parseBody, validationError } from "@/lib/api";
import { blockWriteResponse } from "@/lib/blocks/responses";
import { createBlockSchema, listBlocksSchema } from "@/lib/blocks/schema";
import { createBlock, listBlocks, toDto } from "@/lib/blocks/writes";
import { queryParams } from "@/lib/query";

/**
 * Lists blocks - manual ones and those imported from Google Calendar - by
 * start date. Filters: `propertyId`, `from`/`to` (blocks overlapping that
 * range); `page`, `pageSize` (at most 500).
 */
export async function GET(request: Request) {
  const parsed = listBlocksSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  const { items, ...page } = await listBlocks(parsed.data);
  return Response.json({ items: items.map(toDto), ...page });
}

/**
 * Creates a manual block. Dates shared with a confirmed booking are refused
 * with a 409 naming the bookings in the way.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, createBlockSchema);
  if ("response" in body) return body.response;
  return blockWriteResponse(await createBlock(body.data), true);
}
