/**
 * Runs in the browser before the app becomes interactive: starts the error
 * tracker for client-side errors, lazily (src/lib/sentry-client.ts).
 * Settings are shared with the server; see src/lib/sentry.ts.
 */
import { loadSentry } from "@/lib/sentry-client";

void loadSentry();

export function onRouterTransitionStart(...args: unknown[]): void {
  void loadSentry()?.then((Sentry) =>
    (Sentry.captureRouterTransitionStart as (...a: unknown[]) => void)(...args),
  );
}
