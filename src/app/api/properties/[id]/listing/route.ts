import { isUuid, notFound, parseBody } from "@/lib/api";
import { listingSchema } from "@/lib/listing/schema";
import { getListing, saveListing } from "@/lib/listing/service";
import { getProperty } from "@/lib/properties/service";

type Context = RouteContext<"/api/properties/[id]/listing">;

/** The property's public profile (GitLab #106); blank until filled in. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id) || !(await getProperty(id))) return notFound("Property");
  return Response.json(await getListing(id));
}

/** Replaces the profile; fields left out are blank. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isUuid(id)) return notFound("Property");
  const body = await parseBody(request, listingSchema);
  if ("response" in body) return body.response;
  if (!(await getProperty(id))) return notFound("Property");
  return Response.json(await saveListing(id, body.data));
}
