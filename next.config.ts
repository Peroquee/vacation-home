import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { resolveAppLocale } from "./src/lib/locale";

// NEXT_PUBLIC_APP_LOCALE is inlined into the bundles at build time, so it is
// validated here - when `next dev` or `next build` starts - rather than with
// the runtime configuration in src/env.ts, which could only check a value the
// built app no longer reads. Throws with a message naming the variable.
resolveAppLocale(process.env.NEXT_PUBLIC_APP_LOCALE);

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone with only the files it
  // needs, so the production image carries no dev dependencies (Dockerfile).
  output: "standalone",
};

// Build-time error-tracker setup: names the release and uploads source maps,
// so stack traces from the minified production bundles read as source. All
// optional - without SENTRY_AUTH_TOKEN nothing is uploaded and the build
// needs no network.
const sentryUpload = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  // A self-hosted GlitchTip or Sentry, e.g. http://glitchtip.lan. Defaults to
  // sentry.io when unset.
  sentryUrl: process.env.SENTRY_URL,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Defaults to SENTRY_RELEASE, then the commit SHA the plugin detects
  // (CI_COMMIT_SHA on GitLab, or git). The same name is baked into the
  // client and server bundles, so every event is tagged with its release.
  release: {
    name: process.env.SENTRY_RELEASE || process.env.CI_COMMIT_SHA || undefined,
    create: sentryUpload,
    finalize: sentryUpload,
  },
  sourcemaps: {
    disable: !sentryUpload,
    // Uploaded, then removed from the build output, so they are not served.
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
  silent: !process.env.CI,
});
