"use client";

import { captureError } from "@/lib/sentry-client";
import { useEffect } from "react";

import "./globals.css";

/**
 * Last-resort fallback for an error in the root layout itself (the app shell),
 * which src/app/(app)/error.tsx cannot catch because it renders inside that layout.
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
    // See src/app/(app)/error.tsx: server errors are reported on the server.
    if (!error.digest) captureError(error);
  }, [error]);

  return (
    // Outside the root layout, so without the translations: both languages.
    <html lang="de">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-medium">Etwas ist schiefgelaufen</h1>
        <p className="text-muted-foreground text-sm">Bitte lade die Seite neu.</p>
        <p lang="en" className="text-muted-foreground text-sm">
          Something went wrong. Please reload the page.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">
            Referenz / Reference: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-2 rounded-lg border px-3 py-1.5 text-sm"
          onClick={retry}
        >
          Erneut versuchen / Try again
        </button>
      </body>
    </html>
  );
}
