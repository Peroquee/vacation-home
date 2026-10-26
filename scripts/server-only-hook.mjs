/**
 * Lets the maintenance scripts (tsx, outside Next) load the server modules
 * (GitLab #148). Those import "server-only", whose default entry throws: it
 * is meant to stop server code from reaching a browser bundle. Here, on the
 * server, it resolves with the react-server condition to its empty entry,
 * as Next resolves it for server code. Only that one package is affected.
 *
 *   tsx --import ./scripts/server-only-hook.mjs scripts/bookings-check.ts
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "server-only") return nextResolve(specifier, context);
    return nextResolve(specifier, {
      ...context,
      conditions: [...context.conditions, "react-server"],
    });
  },
});
