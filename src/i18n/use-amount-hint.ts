"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

import { amountExamples } from "@/lib/properties/form";

/**
 * The field error for an amount inputToMinor cannot read, e.g. "must be an
 * amount like 1000.50 or 1000,50, without thousands separators", with the
 * examples of the visitor's language (GitLab #139).
 */
export function useAmountHint(): (currency: string) => string {
  const t = useTranslations("forms");
  const locale = useLocale();
  return useCallback(
    (currency: string) => {
      const [example, alternative] = amountExamples(currency, locale);
      return alternative
        ? t("amountHintEither", { example, alternative })
        : t("amountHint", { example });
    },
    [t, locale],
  );
}
