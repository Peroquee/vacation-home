import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

// Translations: each request's language and messages come from
// src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSentryConfig(withNextIntl(nextConfig), {
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
