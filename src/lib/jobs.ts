/**
 * Runs background work - Google Calendar sync and the like - so that a
 * failure is visible even though nobody is watching. Server-side only.
 *
 * Every log line inside the job carries `job`, `jobId` and the `requestId`
 * of the request that enqueued it, and a failure is both logged and sent to
 * the error tracker with the same ids as tags:
 *
 *   // in a route handler, when enqueuing
 *   queue.add({ bookingId, requestId: await currentRequestId() });
 *
 *   // in the worker
 *   await runJob("gcal.outbound-sync", { requestId: payload.requestId }, async (log) => {
 *     log.info({ bookingId }, "pushing booking");
 *     ...
 *   });
 */
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";

import { getLogContext, withLogContext } from "@/lib/log-context";
import { type Logger, logger } from "@/lib/logger";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

/** The current request's id, for handing to a job it enqueues. */
export async function currentRequestId(): Promise<string | undefined> {
  return getLogContext().requestId ?? (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
}

export async function runJob<T>(
  job: string,
  { requestId }: { requestId?: string },
  work: (log: Logger) => Promise<T>,
): Promise<T> {
  const jobId = crypto.randomUUID();

  return withLogContext({ job, jobId, requestId }, async () => {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    logger.info("job started");

    try {
      const result = await work(logger);
      logger.info({ durationMs: elapsed() }, "job finished");
      return result;
    } catch (err) {
      logger.error({ err, durationMs: elapsed() }, "job failed");
      Sentry.captureException(err, {
        tags: { job, job_id: jobId, ...(requestId && { request_id: requestId }) },
      });
      throw err;
    }
  });
}
