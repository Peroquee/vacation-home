import { fieldError, isUuid, notFound, parseBody } from "@/lib/api";
import { SEASON_OVERLAPS, seasonSchema } from "@/lib/pricing/schema";
import { deleteSeason, saveSeason } from "@/lib/pricing/service";

type Context = RouteContext<"/api/properties/[id]/seasons/[seasonId]">;

/**
 * Replaces a season (GitLab #118). Bookings keep the price they were given:
 * a season change applies to new bookings and re-priced ones only.
 */
export async function PUT(request: Request, { params }: Context) {
  const { id, seasonId } = await params;
  if (!isUuid(id) || !isUuid(seasonId)) return notFound("Season");
  const body = await parseBody(request, seasonSchema);
  if ("response" in body) return body.response;
  const result = await saveSeason(id, body.data, seasonId);
  if ("error" in result) {
    return result.error === "overlaps"
      ? fieldError("startDay", `${SEASON_OVERLAPS}: ${result.with}`)
      : notFound("Season");
  }
  return Response.json(result.season);
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id, seasonId } = await params;
  if (!isUuid(id) || !isUuid(seasonId)) return notFound("Season");
  return (await deleteSeason(id, seasonId))
    ? new Response(null, { status: 204 })
    : notFound("Season");
}
