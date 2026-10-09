/**
 * Liveness: the process is up and serving. Public and cheap, for Docker's
 * health check; it touches nothing else, so a database outage does not get
 * the container restarted in a loop.
 */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
