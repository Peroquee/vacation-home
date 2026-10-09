"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { apiFields, apiText } from "./api-text";

/**
 * The API's English messages in the page's language (src/i18n/api-text.ts):
 * `text(message)` for one, `fields(fields)` for a 422's field messages.
 */
export function useApiText() {
  const t = useTranslations("api");
  return useMemo(
    () => ({
      text: (message: string) => apiText(message, t),
      fields: (fields: Record<string, string[] | undefined>) => apiFields(fields, t),
      /** The message of a failed response's body, or null without one. */
      message: (body: unknown) => {
        const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
        return typeof message === "string" ? apiText(message, t) : null;
      },
    }),
    [t],
  );
}
