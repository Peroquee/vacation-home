/**
 * A listed property's public face, for the public page and API (GitLab
 * #106). Server-side only. Null for an unlisted, archived or unknown
 * property alike.
 */
import { getRequestSettings } from "@/lib/booking-requests/settings";
import type { StayHelpFacts } from "@/lib/help/guest-values";
import { getBankDetails } from "@/lib/payments/bank";
import { type PublicPropertyDto, toPublicDto } from "@/lib/properties/public";
import { todayIn } from "@/lib/finance/recurring";
import { getPaymentTerms } from "@/lib/payment-terms/service";
import { lowestRate } from "@/lib/pricing/engine";
import { pricingRulesFor } from "@/lib/pricing/service";
import { getListedProperty, listListedProperties } from "@/lib/properties/service";

import { getListing, getStayTimes, listPhotos } from "./service";

export async function getPublicProperty(slug: string): Promise<PublicPropertyDto | null> {
  const property = await getListedProperty(slug);
  return property ? publicFace(property) : null;
}

/**
 * What the guests' help on the property page tells (GitLab #127): its
 * terms, deadlines, Kurtaxe and times as set. Whether bank details are set,
 * never the details: the booking page shows those to a guest with a booking.
 */
export async function getStayHelpFacts(slug: string): Promise<StayHelpFacts | null> {
  const property = await getListedProperty(slug);
  if (!property) return null;
  const [terms, pricing, requests, times, bank] = await Promise.all([
    getPaymentTerms(property.id),
    pricingRulesFor(property),
    getRequestSettings(property.id),
    getStayTimes(property.id),
    getBankDetails(property.id),
  ]);
  return {
    terms,
    currency: property.currency,
    requestExpiryDays: requests.expiryDays,
    touristTax: pricing.touristTax,
    times,
    bankDetails: bank !== null,
  };
}

/** Every listed property's public face, oldest first: the start page's (GitLab #117). */
export async function listPublicProperties(): Promise<PublicPropertyDto[]> {
  return Promise.all((await listListedProperties()).map(publicFace));
}

async function publicFace(
  property: Awaited<ReturnType<typeof listListedProperties>>[number],
): Promise<PublicPropertyDto> {
  const [listing, photos, terms, pricing] = await Promise.all([
    getListing(property.id),
    listPhotos(property.id),
    getPaymentTerms(property.id),
    pricingRulesFor(property),
  ]);
  return toPublicDto(property, listing, photos, terms, {
    nightlyRateFromMinor: lowestRate(pricing, todayIn(property.timezone)),
    discounts: pricing.discounts,
    touristTax: pricing.touristTax ? (pricing.touristTax.included ? "included" : "plus") : null,
  });
}
