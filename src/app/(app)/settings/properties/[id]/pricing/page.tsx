import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getFormat } from "@/i18n/get-format";
import { isUuid } from "@/lib/api";
import { todayIn } from "@/lib/today";
import { getPaymentTerms } from "@/lib/payment-terms/service";
import { getTouristTax, listDiscounts, listSeasons } from "@/lib/pricing/service";
import { getProperty } from "@/lib/properties/service";

import { DiscountsCard } from "./discounts-card";
import { RefundScheduleCard } from "./refund-schedule-card";
import { SeasonsCard } from "./seasons-card";
import { TouristTaxCard } from "./tourist-tax-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.pricing");
  return { title: t("title") };
}

/**
 * Everything about a property's prices, in one place (GitLab #118, #119,
 * #120, #123): the seasons, the length-of-stay discounts, the deposit's
 * refund schedule and the Kurtaxe.
 * Each section says in a sentence what it does; the standard rate and the
 * cleaning fee stay with the property itself.
 */
export default async function PricingPage({
  params,
}: PageProps<"/settings/properties/[id]/pricing">) {
  await connection();
  const { id } = await params;
  const property = isUuid(id) ? await getProperty(id) : null;
  if (!property) notFound();
  const [seasons, tiers, touristTax, terms, t, format] = await Promise.all([
    listSeasons(id),
    listDiscounts(id),
    getTouristTax(id),
    getPaymentTerms(id),
    getTranslations("settings.pricing"),
    getFormat(),
  ]);

  return (
    <>
      <PageHeader
        title={t("heading", { name: property.name })}
        description={t("description", {
          rate: format.money(property.defaultNightlyRateMinor, property.currency),
          cleaning: format.money(property.defaultCleaningFeeMinor, property.currency),
        })}
        actions={
          <Link href="/settings" className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
        }
      />
      <div className="space-y-6">
        <SeasonsCard
          property={{
            id: property.id,
            name: property.name,
            currency: property.currency,
            defaultNightlyRateMinor: property.defaultNightlyRateMinor,
            defaultCleaningFeeMinor: property.defaultCleaningFeeMinor,
          }}
          seasons={seasons}
          today={todayIn(property.timezone)}
        />
        <DiscountsCard propertyId={property.id} tiers={tiers} />
        <RefundScheduleCard
          propertyId={property.id}
          depositNonRefundable={terms.depositNonRefundable}
          schedule={terms.refundSchedule}
          today={todayIn(property.timezone)}
        />
        <TouristTaxCard propertyId={property.id} currency={property.currency} rules={touristTax} />
      </div>
    </>
  );
}
