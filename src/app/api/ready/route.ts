import { db } from "@/lib/db";

/**
 * Readiness: the app can serve real requests, i.e. its database answers.
 * Public, for the reverse proxy's health check: 200 when ready, 503 while
 * not (e.g. during a deploy or a database restart), so the proxy holds
 * requests instead of passing them to an app that would fail them. Says
 * nothing about the data.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
