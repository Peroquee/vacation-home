"use client";

import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addDays, type CalendarDate } from "@/lib/calendar-date";

/**
 * The dashboard's period as files (GitLab #90): the financial report as a
 * PDF, and the transactions behind it as CSV (GitLab #83), for exactly the
 * dates and property on screen.
 */
export function ExportMenu({
  from,
  until,
  propertyId,
}: {
  from: CalendarDate;
  /** The last day included. */
  until: CalendarDate;
  propertyId?: string;
}) {
  const t = useTranslations("dashboard.report");
  const tCsv = useTranslations("finance.csv");
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams(extra);
    if (propertyId) params.set("propertyId", propertyId);
    return params.toString();
  };
  const report = `/api/reports/financial?${query({ from, until })}`;
  const csv = (format: string) =>
    `/api/transactions/export?${query({ from, to: addDays(until, 1), format })}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
        <Download data-icon="inline-start" aria-hidden />
        {t("exportMenu")}
        <ChevronDown data-icon="inline-end" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<a href={report} download />}>{t("download")}</DropdownMenuItem>
        <DropdownMenuItem render={<a href={csv("standard")} download />}>
          {t("transactions")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={csv("excel-de")} download />}>
          {tCsv("exportExcel")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
