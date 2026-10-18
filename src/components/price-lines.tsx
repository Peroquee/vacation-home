import { useLocale, useTranslations } from "next-intl";

import { formattersFor } from "@/i18n/format";
import type { StoredBreakdown } from "@/lib/pricing/engine";

/**
 * A price as the engine worked it out (GitLab #118): a line per season or
 * rate ("3 nights × €95.00 · Hauptsaison"), the cleaning fee, and the total.
 * A booking from before the engine shows its total alone. `totalMinor`
 * overrides the total shown, for one set by hand.
 *
 * Renders on server pages and in client forms alike (formattersFor, not
 * useFormat).
 */
export function PriceLines({
  breakdown,
  totalMinor,
  className,
}: {
  breakdown: StoredBreakdown;
  totalMinor?: number;
  className?: string;
}) {
  const t = useTranslations("pricing");
  const format = formattersFor(useLocale());
  const money = (minor: number) => format.money(minor, breakdown.currency);
  const total = totalMinor ?? breakdown.totalMinor;
  return (
    <dl className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm ${className ?? ""}`}>
      {breakdown.kind === "computed" ? (
        <>
          {breakdown.nights.map((line, i) => (
            <div key={i} className="contents">
              <dt>
                {t("nightsAt", { count: line.nights, rate: money(line.rateMinor) })}
                <span className="text-muted-foreground">
                  {" · "}
                  {line.season ?? t("defaultRate")}
                </span>
              </dt>
              <dd className="text-end tabular-nums">{money(line.amountMinor)}</dd>
            </div>
          ))}
          {breakdown.cleaningFeeMinor > 0 ? (
            <div className="contents">
              <dt>{t("cleaning")}</dt>
              <dd className="text-end tabular-nums">{money(breakdown.cleaningFeeMinor)}</dd>
            </div>
          ) : null}
        </>
      ) : (
        <div className="contents">
          <dt className="text-muted-foreground col-span-2">{t("legacy")}</dt>
        </div>
      )}
      <div className="contents font-medium">
        <dt>
          {totalMinor !== undefined && totalMinor !== breakdown.totalMinor
            ? t("totalSet")
            : t("total")}
        </dt>
        <dd className="text-end tabular-nums">{money(total)}</dd>
      </div>
    </dl>
  );
}
