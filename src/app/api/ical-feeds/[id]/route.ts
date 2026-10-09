import { isUuid, notFound } from "@/lib/api";
import { deleteFeed } from "@/lib/ical/feeds";

/** Removes a feed, its blocks and its double-booking issues. 204. */
export async function DELETE(_request: Request, { params }: RouteContext<"/api/ical-feeds/[id]">) {
  const { id } = await params;
  if (!isUuid(id) || !(await deleteFeed(id))) return notFound("Feed");
  return new Response(null, { status: 204 });
}
