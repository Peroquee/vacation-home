import { z } from "zod";

import { isUuid, notFound, parseBody } from "@/lib/api";
import { disableExport, enableExport, getExport } from "@/lib/ical/feeds";

type Context = RouteContext<"/api/properties/[id]/ical-export">;

/** Whether the property's export feed is on, and its URL: `{ enabled, url }`. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const result = isUuid(id) ? await getExport(id) : null;
  return result ? Response.json(result) : notFound("Property");
}

/**
 * Switches the export on. `{ "rotate": true }` gives it a new URL, and the
 * old one stops working at once.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const parsed = await parseBody(request, z.object({ rotate: z.boolean().default(false) }));
  if ("response" in parsed) return parsed.response;
  const result = await enableExport(id, parsed.data.rotate);
  return result ? Response.json(result) : notFound("Property");
}

/** Switches the export off; its URL stops working. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const result = isUuid(id) ? await disableExport(id) : null;
  return result ? Response.json(result) : notFound("Property");
}
