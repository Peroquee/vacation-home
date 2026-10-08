"use client";

import { ErrorState } from "@/components/states";

/**
 * Fallback for an error thrown while rendering any page. The root layout and
 * its shell stay up; only the page area is replaced.
 */
export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorState onRetry={retry} />;
}
