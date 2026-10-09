"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

import { type Formatters, formattersFor } from "./format";

/** The formatters in the language of the page, for client components. */
export function useFormat(): Formatters {
  const locale = useLocale();
  return useMemo(() => formattersFor(locale), [locale]);
}
