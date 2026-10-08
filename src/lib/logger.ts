/**
 * Structured JSON logging. Server-side only.
 *
 * One JSON object per line on stdout:
 *
 *   {"level":"info","time":"2026-07-14T10:00:00.000Z","requestId":"...","msg":"booking saved","bookingId":"..."}
 *
 * - Correlation ids (`requestId`, `job`, `jobId`) are added from the current
 *   log context - see ./log-context.
 * - Every argument - the message, its fields, errors - is passed through
 *   `scrub` before it is written, so guest emails and OAuth tokens never
 *   reach a log line, even inside an error message.
 *
 * Log with fields, not interpolation: `log.info({ bookingId }, "booking saved")`.
 * Pass errors as `err`: `log.error({ err }, "sync failed")`.
 * In development, pipe through `npx pino-pretty` for readable output.
 */
import { headers } from "next/headers";
import pino, { type DestinationStream, type Logger } from "pino";

import { getLogContext } from "@/lib/log-context";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { scrub } from "@/lib/scrub";

export type { Logger };

export function createLogger(destination?: DestinationStream, level = "info"): Logger {
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      mixin: () => ({ ...getLogContext() }),
      hooks: {
        // Scrubs the arguments of every call, so a message string with an
        // email in it is caught as well as a field.
        logMethod(args, method) {
          method.apply(this, scrub(args) as typeof args);
        },
      },
      // `scrub` has already turned errors into plain objects; keep pino from
      // re-serialising them.
      serializers: { err: (err: unknown) => err },
    },
    destination,
  );
}

/**
 * The process-wide logger. Prefer `requestLogger()` inside a request.
 *
 * Its level is set from LOG_LEVEL at boot, in src/instrumentation-node.ts,
 * rather than read here: `next build` imports this module, and must not need
 * the runtime configuration to do so.
 */
export const logger = createLogger();

/**
 * A logger bound to the current request's id, for route handlers, server
 * actions and server components.
 */
export async function requestLogger(): Promise<Logger> {
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  return requestId ? logger.child({ requestId }) : logger;
}
