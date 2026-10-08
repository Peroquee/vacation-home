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
    // Same prototype, so it still prints as (and is) a PrismaClientKnownRequestError
    // or whatever it was, with its `cause` chain.
    const copy = Object.create(Object.getPrototypeOf(arg)) as Error;
    for (const key of Object.getOwnPropertyNames(arg)) {
      const { enumerable } = Object.getOwnPropertyDescriptor(arg, key)!;
      // Read through the original: `stack` is an accessor in current V8,
      // and its getter only works on the error it belongs to.
      const value = (arg as unknown as Record<string, unknown>)[key];
      Object.defineProperty(copy, key, {
        value:
          key === "cause" || key === "errors" ? scrubArgumentDeep(value) : scrubArgument(value),
        enumerable,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  }
  return scrub(arg);
}

function scrubArgumentDeep(value: unknown): unknown {
  return Array.isArray(value) ? value.map(scrubArgument) : scrubArgument(value);
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
