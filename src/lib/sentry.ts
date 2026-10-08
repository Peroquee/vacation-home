/**
 * Error-tracker settings shared by the server (src/instrumentation-node.ts)
 * and the browser (src/instrumentation-client.ts).
 *
 * The SDK is Sentry's, but nothing ties the app to Sentry's hosted service:
 * the same protocol is spoken by GlitchTip (open source, self-hostable - the
 * intended tracker for a LAN-only deployment) and by self-hosted Sentry. It
 * stays off until NEXT_PUBLIC_SENTRY_DSN is set. The DSN is public by design - it only allows
 * submitting events - and is inlined at build time like every NEXT_PUBLIC_
 * variable.
 *
 * Releases and source maps are handled at build time by `withSentryConfig`
 * in next.config.ts.
 */
import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

import { scrub } from "@/lib/scrub";

/* eslint-disable no-restricted-properties -- NEXT_PUBLIC_ values and
   NODE_ENV must be read literally so Next can inline them. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV;
/* eslint-enable no-restricted-properties */

export function sentryOptions(): BrowserOptions & NodeOptions {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment,
    // The SDK collects generously by default. Opt out of everything that can
    // carry a guest's details or a credential; what is still sent is
    // scrubbed of emails and tokens below - see src/lib/scrub.ts.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { allow: ["user-agent", "referer", "content-type", "x-request-id"] },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrub(event) as typeof event,
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb) as typeof breadcrumb,
  };
}
