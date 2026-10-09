import { validationError } from "@/lib/api";
import { listIssues, listIssuesSchema, toDto } from "@/lib/google/sync-issues";
import { queryParams } from "@/lib/query";

/**
 * Google Calendar sync issues for review, newest first: today, Google events
 * that overlap a confirmed booking and so were not imported. Filters:
 * `propertyId`, `status` (`open`, the default, or `all`).
 */
export async function GET(request: Request) {
  const parsed = listIssuesSchema.safeParse(queryParams(request));
  if (!parsed.success) return validationError(parsed.error);
  return Response.json((await listIssues(parsed.data)).map(toDto));
}
