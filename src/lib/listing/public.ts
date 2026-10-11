/**
 * A listed property's public face, for the public page and API (GitLab
 * #106). Server-side only. Null for an unlisted, archived or unknown
 * property alike.
 */
import { type PublicPropertyDto, toPublicDto } from "@/lib/properties/public";
import { getListedProperty } from "@/lib/properties/service";

import { getListing, listPhotos } from "./service";

export async function getPublicProperty(slug: string): Promise<PublicPropertyDto | null> {
  const property = await getListedProperty(slug);
  if (!property) return null;
  const [listing, photos] = await Promise.all([getListing(property.id), listPhotos(property.id)]);
  return toPublicDto(property, listing, photos);
}
