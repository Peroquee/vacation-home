/**
 * A listed property's public face, for the public page and API (GitLab
 * #106). Server-side only. Null for an unlisted, archived or unknown
 * property alike.
 */
import { type PublicPropertyDto, toPublicDto } from "@/lib/properties/public";
import { getPaymentTerms } from "@/lib/payment-terms/service";
import { getListedProperty, listListedProperties } from "@/lib/properties/service";

import { getListing, listPhotos } from "./service";

export async function getPublicProperty(slug: string): Promise<PublicPropertyDto | null> {
  const property = await getListedProperty(slug);
  return property ? publicFace(property) : null;
}

/** Every listed property's public face, oldest first: the start page's (GitLab #117). */
export async function listPublicProperties(): Promise<PublicPropertyDto[]> {
  return Promise.all((await listListedProperties()).map(publicFace));
}

async function publicFace(
  property: Awaited<ReturnType<typeof listListedProperties>>[number],
): Promise<PublicPropertyDto> {
  const [listing, photos, terms] = await Promise.all([
    getListing(property.id),
    listPhotos(property.id),
    getPaymentTerms(property.id),
  ]);
  return toPublicDto(property, listing, photos, terms);
}
