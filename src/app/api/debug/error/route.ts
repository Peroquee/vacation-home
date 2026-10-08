import { notFound } from "next/navigation";

import { env } from "@/env";
import { requestLogger } from "@/lib/logger";

/**
 * Throws on purpose, so the error tracker and logging can be checked end to
 * end: the error should appear in the tracker with a readable stack trace,
 * tagged with this request's id, and the log line should show the id and no
 * personal data. 404 unless ENABLE_ERROR_TEST_ROUTE is "true".
 */
export async function GET() {
  if (!env.ENABLE_ERROR_TEST_ROUTE) notFound();

  const log = await requestLogger();
  log.warn({ guestEmail: "guest@example.com" }, "about to throw a test error");
  throw new Error("Deliberate test error for guest@example.com");
}
