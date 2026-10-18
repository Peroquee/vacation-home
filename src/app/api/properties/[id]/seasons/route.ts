import { fieldError, isUuid, notFound, parseBody } from "@/lib/api";
import { SEASON_OVERLAPS, seasonSchema } from "@/lib/pricing/schema";
import { listSeasons, saveSeason } from "@/lib/pricing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/seasons">;

/** The property's seasons (GitLab #118), in calendar order, one-off ones last. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await listSeasons(id));
}

/**
 * Adds a season. 422 when it would overlap another of its kind (yearly or
 * one-off; a one-off season may lie inside a yearly one, and wins).
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, seasonSchema);
  if ("response" in body) return body.response;
  const result = await saveSeason(id, body.data);
  if ("error" in result) {
    return result.error === "overlaps"
      ? fieldError("startDay", `${SEASON_OVERLAPS}: ${result.with}`)
      : notFound("Property");
  }
  return Response.json(result.season, { status: 201 });
}
