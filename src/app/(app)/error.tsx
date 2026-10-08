"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { ErrorState } from "@/components/states";

/**
 * Fallback for an error thrown while rendering any page. The root layout and
 * its shell stay up; only the page area is replaced.
 *
 * In production, errors from server components arrive with a generic message
 * and a `digest` that matches the server log entry. The digest is shown so a
 * user can quote it.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // An error with a digest came from the server, where onRequestError has
    // already reported it in full; this copy would only be a duplicate with
    // the message redacted.
    if (!error.digest) Sentry.captureException(error);
  }, [error]);

  return <ErrorState reference={error.digest} onRetry={retry} />;
}
