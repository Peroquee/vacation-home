import { isUuid, notFound, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createFeed, createFeedSchema, listFeeds, toFeedDto } from "@/lib/ical/feeds";
import { importFeed } from "@/lib/ical/import";

/** The property's booking platform feeds (GitLab #99), without their URLs. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/properties/[id]/ical-feeds">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  if (!(await db.property.findUnique({ where: { id }, select: { id: true } }))) {
    return notFound("Property");
  }
  return Response.json((await listFeeds(id)).map(toFeedDto));
}

/**
 * Adds a feed (`name`, `url`) and fetches it at once, so the answer already
 * says whether it worked: 201 with the feed and its first result.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/properties/[id]/ical-feeds">,
) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  if (!(await db.property.findUnique({ where: { id }, select: { id: true } }))) {
    return notFound("Property");
  }
  const parsed = await parseBody(request, createFeedSchema);
  if ("response" in parsed) return parsed.response;
  const feed = await createFeed(id, parsed.data);
  await importFeed(feed.id);
  const fresh = await db.icalFeed.findUniqueOrThrow({ where: { id: feed.id } });
  return Response.json(toFeedDto(fresh), {
    status: 201,
    headers: { Location: `/api/ical-feeds/${feed.id}` },
  });
}
