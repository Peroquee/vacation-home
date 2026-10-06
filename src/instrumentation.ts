import { EnvValidationError } from "./env-error";

/**
 * Next calls `register()` once per server process — in `next dev` and in
 * `next start`, but not during `next build`. Importing the config module here
 * is what makes a missing or malformed environment variable stop the app at
 * boot, rather than surfacing much later as an `undefined` connection string.
 *
 * The import is dynamic so that merely loading this file does not validate;
 * only the call does.
 */
export async function register() {
  try {
    await import("./env");
  } catch (error) {
    // The Edge runtime has no `process.exit`; let the error propagate there.
    if (typeof process === "undefined" || typeof process.exit !== "function") {
      throw error;
    }

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
    // stderr is a pipe (CI logs, `docker build`). `node:fs` would give a
    // synchronous write, but Next also compiles this file for the Edge
    // runtime, where a `node:` import fails to build.
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
