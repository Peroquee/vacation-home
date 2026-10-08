"use client";

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
    // Until error tracking exists, the browser console is where this lands.
    console.error(error);
  }, [error]);

  return <ErrorState reference={error.digest} onRetry={retry} />;
}
