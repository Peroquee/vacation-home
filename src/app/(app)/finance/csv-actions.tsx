"use client";

import { ChevronDown, Download, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * CSV export of what the ledger shows, in either format, and the way to
 * the import (GitLab #83). `query` holds the ledger's current filters.
 */
export function CsvActions({ query }: { query: Record<string, string | undefined> }) {
  const t = useTranslations("finance.csv");
  const href = (format: "standard" | "excel-de") => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    params.set("format", format);
    return `/api/transactions/export?${params}`;
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
          <Download data-icon="inline-start" aria-hidden />
          {t("export")}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<a href={href("standard")} download />}>
            {t("exportStandard")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={href("excel-de")} download />}>
            {t("exportExcel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Link href="/finance/import" className={buttonVariants({ variant: "outline" })}>
        <Upload data-icon="inline-start" aria-hidden />
        {t("import")}
      </Link>
    </>
  );
}
