/**
 * The error tracker in the browser, loaded lazily (GitLab #97): the SDK is
 * one of the largest libraries the app ships, so it is not part of any
 * page's first-load JavaScript. It loads as its own chunk right after
 * start, and only when NEXT_PUBLIC_SENTRY_DSN is set; without a DSN the
 * browser never downloads it. An error in the moment before it is loaded
 * goes unreported - the price of not delaying every page.
 */
import { sentryOptions } from "@/lib/sentry";

// Read literally, so Next inlines it and drops the import without a DSN.
// eslint-disable-next-line no-restricted-properties
const enabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

type Sdk = typeof import("@sentry/nextjs");
let sdk: Promise<Sdk> | null = null;

/** Starts the tracker (once); null when there is none. */
export function loadSentry(): Promise<Sdk> | null {
  if (!enabled) return null;
  sdk ??= import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions());
    return Sentry;
  });
  return sdk;
}

/** Reports an error the app caught (an error boundary). */
export function captureError(error: unknown): void {
  void loadSentry()?.then((Sentry) => Sentry.captureException(error));
}
