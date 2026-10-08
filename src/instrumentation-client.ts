/**
 * Runs in the browser before the app becomes interactive: starts the error
 * tracker for client-side errors. Settings are shared with the server; see
 * src/lib/sentry.ts.
 */
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
