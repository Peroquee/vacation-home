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

import { env } from "@/env";
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
          // `log.error(err)` / `log.error(err, "msg")`: file the error under
          // `err`, defaulting the message to its own, as pino would.
          const [first, ...rest] = args as unknown[];
          const normalised =
            first instanceof Error
              ? [{ err: first }, ...(rest.length > 0 ? rest : [first.message])]
              : args;
          method.apply(this, scrub(normalised) as typeof args);
        },
      },
      // `scrub` has already turned errors into plain objects; keep pino from
      // re-serialising them.
      serializers: { err: (err: unknown) => err },
    },
    destination,
  );
}

let instance: Logger | undefined;

/**
 * The process-wide logger. Prefer `requestLogger()` inside a request.
 *
 * Created on first use, with the level from LOG_LEVEL. Not on import: Next
 * bundles this module separately for instrumentation and for the app, and
 * `next build` imports it without any runtime configuration, so neither a
 * level read at import nor one set once from the boot hook would hold.
 */
export const logger: Logger = new Proxy({} as Logger, {
  get: (_target, name) => {
    instance ??= createLogger(undefined, env.LOG_LEVEL);
    const value = Reflect.get(instance, name, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  set: (_target, name, value) => {
    instance ??= createLogger(undefined, env.LOG_LEVEL);
    return Reflect.set(instance, name, value, instance);
  },
});

/**
 * A logger bound to the current request's id, for route handlers, server
 * actions and server components.
 */
export async function requestLogger(): Promise<Logger> {
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  return requestId ? logger.child({ requestId }) : logger;
}
