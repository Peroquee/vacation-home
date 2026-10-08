import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

import { EnvValidationError } from "./env-error";
import { REQUEST_ID_HEADER } from "./lib/request-id";
import { scrubConsole } from "./lib/scrub-console";
import { sentryOptions } from "./lib/sentry";

/**
 * The Node-runtime half of the instrumentation hook. Separated from
 * src/instrumentation.ts so that the Node APIs below never enter the Edge
 * bundle's module graph - see the comment there.
 *
 * Importing the config module is what makes a missing or malformed environment
 * variable stop the app at boot, rather than surfacing much later as an
 * `undefined` connection string.
 */
export async function bootstrap(): Promise<void> {
  // First, so nothing printed from here on - including the configuration
  // report below and Next's own error output - can carry personal data.
  scrubConsole();

  try {
    // Dynamic, so that validation happens when this runs rather than when the
    // module is loaded.
    await import("./env");

    // After validation, so a misconfigured process never reports as healthy.
    Sentry.init(sentryOptions());
  } catch (error) {
    // A configuration failure is already a formatted, readable report, so its
    // stack would only be noise. Anything else (a broken import, a typo in the
    // schema) needs the stack to be locatable at all.
    const report =
      error instanceof EnvValidationError
        ? error.message
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error);

    // Next treats a failed instrumentation hook as an unhandled rejection: it
    // logs the error but leaves the server listening, so an app with invalid
    // configuration would report "Ready" and then serve traffic. Exit instead.
    //
    // Exit from the write callback, because `process.exit` does not flush a
    // pending asynchronous write and would otherwise lose the report when
    // stderr is a pipe (CI logs, `docker build`).
    process.exitCode = 1;
    let exiting = false;
    const exit = () => {
      if (exiting) return;
      exiting = true;
      process.exit(1);
    };

    // Backstop, so a callback that never fires cannot leave the server up.
    const timer = setTimeout(exit, 2000);
    timer.unref?.();

    process.stderr.write(`\n${report}\n\n`, exit);
  }
}

/** The Node half of `onRequestError` in src/instrumentation.ts. */
export async function reportRequestError(
  ...[error, request, context]: Parameters<Instrumentation.onRequestError>
): Promise<void> {
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = Array.isArray(header) ? header[0] : header;

  // Dynamic for the same reason as ./env above: the logger reads the
  // validated configuration.
  const { logger } = await import("./lib/logger");
  logger.error(
    {
      err: error,
      requestId,
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    "request failed",
  );

  Sentry.withScope((scope) => {
    if (requestId) scope.setTag("request_id", requestId);
    Sentry.captureRequestError(error, request, context);
  });
}
