import { useLocale, useTranslations } from "next-intl";

import { formattersFor } from "@/i18n/format";
import { depositFor } from "@/lib/payment-terms/terms";
import type { PublicCancellation } from "@/lib/properties/public";

/**
 * The cancellation policy in a sentence (GitLab #116): next to the price,
 * and above the consent the guest ticks. With a total, the deposit as an
 * amount; without, as the property's percentage or fixed amount.
 */
export function CancellationNote({
  policy,
  currency,
  totalMinor,
  className,
}: {
  policy: PublicCancellation;
  currency: string;
  totalMinor?: number;
  className?: string;
}) {
  const t = useTranslations("cancellation");
  // Not useFormat: this renders on the server page as well as in the form.
  const format = formattersFor(useLocale());
  if (!policy.depositNonRefundable) return <p className={className}>{t("refundable")}</p>;
  const deposit =
    totalMinor !== undefined
      ? format.money(
          depositFor(totalMinor, {
            depositPercent: policy.depositPercent,
            depositFixedMinor: policy.depositFixedMinor,
          }),
          currency,
        )
      : policy.depositPercent !== null
        ? t("percentOfTotal", { percent: policy.depositPercent })
        : format.money(policy.depositFixedMinor ?? 0, currency);
  return <p className={className}>{t("nonRefundable", { deposit })}</p>;
}
