/**
 * Scrubs everything written through `console` on the server.
 *
 * The logger scrubs what the app logs, but Next itself prints errors with
 * `console.error` ("⨯ Error: ...") and dependencies log however they like.
 * Without this, a guest's email in an exception message would reach the logs
 * that way. Installed once at boot by src/instrumentation-node.ts.
 */
import { scrub, scrubString } from "@/lib/scrub";

const METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

/** Like `scrub`, but keeps errors as errors so they still print with a stack. */
function scrubArgument(arg: unknown): unknown {
  if (typeof arg === "string") return scrubString(arg);
  if (arg instanceof Error) {
    const copy = new Error(scrubString(arg.message));
    copy.name = arg.name;
    copy.stack = arg.stack === undefined ? undefined : scrubString(arg.stack);
    // Own properties such as Next's `digest`.
    return Object.assign(copy, scrub({ ...arg }));
  }
  return scrub(arg);
}

let installed = false;

export function scrubConsole(target: Console = console): void {
  if (target === console && installed) return;
  if (target === console) installed = true;

  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(scrubArgument));
  }
}
