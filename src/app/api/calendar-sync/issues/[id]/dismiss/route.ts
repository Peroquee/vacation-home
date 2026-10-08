import { isUuid, notFound } from "@/lib/api";
import { dismissIssue, toDto } from "@/lib/google/sync-issues";

/** Dismisses an issue (it stays in the history with `resolution: "dismissed"`). */
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/calendar-sync/issues/[id]/dismiss">,
) {
  const { id } = await params;
  const issue = isUuid(id) ? await dismissIssue(id) : null;
  return issue ? Response.json(toDto(issue)) : notFound("Sync issue");
}
