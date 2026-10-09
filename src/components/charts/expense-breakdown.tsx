import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { formattersFor } from "@/i18n/format";
import type { BreakdownRow } from "@/lib/dashboard/breakdown";

/**
 * Where the money goes: one horizontal bar per category, largest first, in
 * the colour configured for the category, with its amount and share written
 * beside it. Bars rather than a donut: lengths compare more exactly than
 * angles and leave room for long names. Every row carries its name as text,
 * so the user-chosen colours never have to tell categories apart on their
 * own. A category row leads to the ledger filtered to it.
 */
export function ExpenseBreakdown({
  rows,
  currency,
  categoryHref,
}: {
  rows: BreakdownRow[];
  currency: string;
  /** Where a category's row leads, e.g. the ledger filtered to it. */
  categoryHref?: (categoryId: string) => string;
}) {
  // Bars are scaled to the largest, so the top one spans the track.
  const largest = Math.max(...rows.map((r) => r.amountMinor), 1);
  const t = useTranslations("charts.breakdown");
  const locale = useLocale();
  const money = (minor: number) => formattersFor(locale).money(minor, currency);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  return (
    <ul className="space-y-3" aria-label={t("label")}>
      {rows.map((row) => {
        const width = `${(row.amountMinor / largest) * 100}%`;
        const label =
          row.kind === "other"
            ? t("otherList", {
                count: row.categories.length,
                names: row.categories.map((c) => c.name).join(", "),
              })
            : row.name;
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {row.kind === "other" ? t("other", { count: row.categories.length }) : row.name}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{money(row.amountMinor)}</span>{" "}
                <span className="text-muted-foreground">
                  {row.share === null ? "" : percent.format(row.share)}
                </span>
              </span>
            </div>
            <div className="mt-1 h-3" aria-hidden>
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width,
                  // "Other" is many categories: a neutral, never a series colour.
                  backgroundColor: row.kind === "other" ? "var(--muted-foreground)" : row.color,
                  minWidth: 2,
                }}
              />
            </div>
          </>
        );
        return (
          <li key={row.kind === "other" ? "other" : row.categoryId} title={label}>
            {row.kind === "category" && categoryHref ? (
              <Link
                href={categoryHref(row.categoryId)}
                className="hover:bg-muted/60 focus-visible:ring-ring -mx-2 block rounded-md px-2 py-1 outline-none focus-visible:ring-2"
                aria-label={
                  row.share === null
                    ? t("link", { name: row.name, amount: money(row.amountMinor) })
                    : t("linkShare", {
                        name: row.name,
                        amount: money(row.amountMinor),
                        share: percent.format(row.share),
                      })
                }
              >
                {content}
              </Link>
            ) : (
              <div className="-mx-2 px-2 py-1" aria-label={label}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
