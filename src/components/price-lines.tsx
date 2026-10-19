import { useLocale, useTranslations } from "next-intl";

import { formattersFor } from "@/i18n/format";
import type { PriceBreakdown, StoredBreakdown } from "@/lib/pricing/engine";

/**
 * A price as the engine worked it out (GitLab #118): a line per season or
 * rate ("3 nights × €95.00 · Hauptsaison"), the length-of-stay discount
 * (GitLab #119), the cleaning fee, the Kurtaxe (GitLab #120), and the total.
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
          {breakdown.discount ? (
            <div className="contents text-emerald-700 dark:text-emerald-400">
              <dt>
                {t("discount", {
                  nights: breakdown.discount.minNights,
                  percent: breakdown.discount.percent,
                })}
              </dt>
              <dd className="text-end tabular-nums">−{money(breakdown.discount.amountMinor)}</dd>
            </div>
          ) : null}
          {breakdown.cleaningFeeMinor > 0 ? (
            <div className="contents">
              <dt>{t("cleaning")}</dt>
              <dd className="text-end tabular-nums">{money(breakdown.cleaningFeeMinor)}</dd>
            </div>
          ) : null}
          {breakdown.touristTax ? (
            <TouristTaxLines tax={breakdown.touristTax} money={money} />
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

/**
 * The Kurtaxe (GitLab #120): a line per age group and rate, or the owner's
 * own amount. Included in the rates, it is shown but not added.
 */
function TouristTaxLines({
  tax,
  money,
}: {
  tax: NonNullable<PriceBreakdown["touristTax"]>;
  money: (minor: number) => string;
}) {
  const t = useTranslations("pricing");
  const amount = (minor: number) => (tax.included ? `(${money(minor)})` : money(minor));
  if (tax.manual) {
    return (
      <div className="contents">
        <dt>
          {t(tax.included ? "taxManualIncluded" : "taxManual")}
          {tax.manual.note ? (
            <span className="text-muted-foreground"> · {tax.manual.note}</span>
          ) : null}
        </dt>
        <dd className="text-end tabular-nums">{amount(tax.amountMinor)}</dd>
      </div>
    );
  }
  return (
    <>
      {tax.lines.map((line, i) => (
        <div key={i} className="contents">
          <dt>
            {t(tax.included ? "taxIncluded" : "tax")}
            {": "}
            {line.group
              ? t("taxChildren", {
                  persons: line.persons,
                  from: line.group.fromAge,
                  to: line.group.toAge,
                  nights: line.nights,
                  rate: money(line.rateMinor),
                })
              : t("taxAdults", {
                  persons: line.persons,
                  nights: line.nights,
                  rate: money(line.rateMinor),
                })}
            {line.period ? <span className="text-muted-foreground"> · {line.period}</span> : null}
          </dt>
          <dd className="text-end tabular-nums">{amount(line.amountMinor)}</dd>
        </div>
      ))}
    </>
  );
}
