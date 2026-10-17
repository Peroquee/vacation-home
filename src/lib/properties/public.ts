/**
 * What the public booking site may show of a property (GitLab #105, #106).
 * An explicit allow-list, never a copy minus some fields: a column added to
 * properties or listings later stays private until it is added here on
 * purpose. The address, the iCal token, the internal notes and everything
 * operational stay out.
 */
import type { Property } from "@/generated/prisma/client";
import type { ListingDto, PhotoDto } from "@/lib/listing/service";
import type { PaymentTerms } from "@/lib/payment-terms/terms";

/** A text in both languages; the page shows the visitor's (`pickText`). */
export type PublicText = { en: string; de: string };

export type PublicPhotoDto = {
  alt: PublicText;
  /** Smallest first, for `srcset`. */
  sizes: { width: number; height: number; url: string }[];
};

/** The cancellation policy (GitLab #116), with the deposit it is about. */
export type PublicCancellation = Pick<
  PaymentTerms,
  "depositNonRefundable" | "depositPercent" | "depositFixedMinor"
>;

export type PublicPropertyDto = {
  slug: string;
  title: PublicText;
  /** ISO 4217: every price on the public page is in it. */
  currency: string;
  /** The default nightly rate, shown as "from"; null when none is set. */
  nightlyRateFromMinor: number | null;
  /** Town or region only. */
  location: string;
  description: PublicText;
  houseRules: PublicText;
  maxGuests: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  checkInTime: string | null;
  checkOutTime: string | null;
  /** The cover first. */
  photos: PublicPhotoDto[];
  cancellation: PublicCancellation;
};

export function toPublicDto(
  property: Property & { slug: string },
  listing: ListingDto,
  photos: PhotoDto[],
  terms: PaymentTerms,
): PublicPropertyDto {
  const base = `/api/public/properties/${property.slug}/photos`;
  // Untitled in both languages: the property's own name rather than nothing.
  const titled = listing.titleEn || listing.titleDe;
  return {
    slug: property.slug,
    title: titled ? { en: listing.titleEn, de: listing.titleDe } : { en: property.name, de: "" },
    currency: property.currency,
    nightlyRateFromMinor:
      property.defaultNightlyRateMinor > 0 ? property.defaultNightlyRateMinor : null,
    location: listing.location,
    description: { en: listing.descriptionEn, de: listing.descriptionDe },
    houseRules: { en: listing.houseRulesEn, de: listing.houseRulesDe },
    maxGuests: listing.maxGuests,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    amenities: listing.amenities,
    checkInTime: listing.checkInTime,
    checkOutTime: listing.checkOutTime,
    photos: photos.map((photo) => ({
      alt: { en: photo.altEn, de: photo.altDe },
      sizes: photo.sizes.map(({ width, height, file }) => ({
        width,
        height,
        url: `${base}/${file}`,
      })),
    })),
    cancellation: {
      depositNonRefundable: terms.depositNonRefundable,
      depositPercent: terms.depositPercent,
      depositFixedMinor: terms.depositFixedMinor,
    },
  };
}

/** The text in the visitor's language, else in the other one. */
export function pickText(text: PublicText, locale: string): string {
  return locale.startsWith("de") ? text.de || text.en : text.en || text.de;
}

/** The first `max` characters of `text`, cut at a word, with an ellipsis. */
export function shortened(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : flat.slice(0, max)).replace(/[\s,.;:]+$/, "")}…`;
}
