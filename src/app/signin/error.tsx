"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { ErrorState } from "@/components/states";

/** Fallback for the sign-in page, which sits outside the app's own boundary. */
export default function SignInError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Errors with a digest were already reported on the server.
    if (!error.digest) Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState
        className="w-full max-w-sm"
        description="Sign-in is unavailable right now. Please try again in a moment."
        reference={error.digest}
        onRetry={retry}
      />
    </main>
  );
}
