/**
 * What the public booking site may show of a property (GitLab #105). An
 * explicit allow-list, never a copy minus some fields: a column added to
 * properties later stays private until it is added here on purpose. The
 * address, the iCal token and everything operational stay out.
 */
import type { Property } from "@/generated/prisma/client";

export type PublicPropertyDto = {
  slug: string;
  name: string;
  /** ISO 4217: every price on the public page is in it. */
  currency: string;
};

export function toPublicDto(property: Property & { slug: string }): PublicPropertyDto {
  return { slug: property.slug, name: property.name, currency: property.currency };
}
