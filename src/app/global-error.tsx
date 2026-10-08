"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { APP_LOCALE } from "@/lib/locale";

import "./globals.css";

/**
 * Last-resort fallback for an error in the root layout itself (the app shell),
 * which src/app/error.tsx cannot catch because it renders inside that layout.
 * Replaces the whole document, so it brings its own <html> and <body>.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={APP_LOCALE}>
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">Please reload the page.</p>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          className="mt-2 rounded-lg border px-3 py-1.5 text-sm"
          onClick={retry}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
