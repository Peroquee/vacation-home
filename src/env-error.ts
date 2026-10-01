/**
 * Lives in its own module so that `src/instrumentation.ts` can recognise a
 * configuration failure without importing `src/env.ts` — importing that would
 * run validation at load time and defeat its deferred import.
 */
export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";
}
