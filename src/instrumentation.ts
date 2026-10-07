/**
 * Next calls `register()` once per server process, in every runtime it
 * compiles this file for - including the Edge runtime.
 *
 * The Node-only work therefore lives in its own module, imported only once the
 * runtime is known to be Node. A runtime guard is not enough on its own:
 * Turbopack analyses the Edge bundle statically and warns about `process.exit`,
 * `process.exitCode` and `process.stderr` even along a branch that could never
 * execute there. Keeping them out of this file's module graph removes the
 * warnings rather than suppressing them.
 */
export async function register() {
  // NEXT_RUNTIME is set by Next itself, is not part of the validated schema,
  // and has to be read literally here: this check is what keeps the Node APIs
  // in ./instrumentation-node out of the Edge bundle.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { bootstrap } = await import("./instrumentation-node");
  await bootstrap();
}
