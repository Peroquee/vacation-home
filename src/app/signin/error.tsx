"use client";

import { captureError } from "@/lib/sentry-client";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("signin");
  useEffect(() => {
    // Errors with a digest were already reported on the server.
    if (!error.digest) captureError(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState
        className="w-full max-w-sm"
        description={t("unavailable")}
        reference={error.digest}
        onRetry={retry}
      />
    </main>
  );
}
