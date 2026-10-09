import { isUuid, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { toFeedDto } from "@/lib/ical/feeds";
import { importFeed } from "@/lib/ical/import";

/** Fetches a feed now rather than at its next turn; answers with the feed. */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/ical-feeds/[id]/refresh">,
) {
  const { id } = await params;
  if (!isUuid(id) || !(await importFeed(id))) return notFound("Feed");
  return Response.json(toFeedDto(await db.icalFeed.findUniqueOrThrow({ where: { id } })));
}
