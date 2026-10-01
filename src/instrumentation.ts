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
    const message = error instanceof Error ? error.message : String(error);

    // Next treats a failed instrumentation hook as an unhandled rejection: it
    // logs the error but leaves the server listening, so an app with invalid
    // configuration would report "Ready" and then serve traffic. Exit instead.
    if (typeof process !== "undefined" && typeof process.exit === "function") {
      // Written synchronously because process.exit does not flush async stdio,
      // which loses the diagnostic when stderr is a pipe (CI logs, docker).
      const { writeSync } = await import("node:fs");
      writeSync(2, `\n${message}\n\n`);
      process.exit(1);
    }

    // Edge runtime: no process.exit, so let it propagate.
    throw error;
  }
}
