/**
 * Property persistence. Server-side only. Route handlers validate input with
 * ./schema and translate the results below into HTTP responses.
 */
import type { Property } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { db } from "@/lib/db";
import { isPrismaError, orNullIfMissing } from "@/lib/db-errors";

import { type CreatePropertyInput, SLUG, type UpdatePropertyInput } from "./schema";

/** The API's view of a property: `archived` spelled out alongside its time. */
/** A property as the API shows it. The iCal export token is never in it. */
export type PropertyDto = Omit<
  Property,
  "archivedAt" | "createdAt" | "updatedAt" | "icalExportToken"
> & {
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toDto(property: Property): PropertyDto {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { archivedAt, createdAt, updatedAt, icalExportToken, ...rest } = property;
  return {
    ...rest,
    archived: archivedAt !== null,
    archivedAt: archivedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/** Active properties by name; archived ones too when asked. */
export async function listProperties({
  includeArchived = false,
}: { includeArchived?: boolean } = {}): Promise<Property[]> {
  return db.property.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
}

export async function getProperty(id: string): Promise<Property | null> {
  return db.property.findUnique({ where: { id } });
}

/** "slug_taken" when another property already has the slug. */
export async function createProperty(input: CreatePropertyInput): Promise<Property | "slug_taken"> {
  try {
    return await db.property.create({ data: input });
  } catch (error) {
    // The slug is the only unique field a client chooses.
    if (isPrismaError(error, "P2002")) return "slug_taken";
    throw error;
  }
}

/**
 * The property behind a public page, or null: only a listed, active one. An
 * unlisted or archived property is to the public site what a missing one
 * is, so no answer tells them apart.
 */
export async function getListedProperty(
  slug: string,
): Promise<(Property & { slug: string }) | null> {
  if (!SLUG.test(slug)) return null;
  const property = await db.property.findFirst({
    where: { slug, publiclyListed: true, archivedAt: null },
  });
  return property?.slug ? { ...property, slug: property.slug } : null;
}

/**
 * Null when there is no such property; "currency_locked" when the currency
 * would change while transactions are recorded in the old one (the
 * database refuses: their amounts are minor units of that currency);
 * "slug_taken" when another property has the slug; "slug_required" when
 * the property would end up listed without a slug (the database refuses
 * that too, but without a usable error).
 */
export async function updateProperty(
  id: string,
  input: UpdatePropertyInput,
): Promise<Property | null | "currency_locked" | "slug_taken" | "slug_required"> {
  const listingNeedsStoredSlug = input.publiclyListed === true && input.slug === undefined;
  const slugRemovedWhileListed = input.slug === null && input.publiclyListed === undefined;
  if (listingNeedsStoredSlug || slugRemovedWhileListed) {
    const current = await getProperty(id);
    if (!current) return null;
    if (listingNeedsStoredSlug && current.slug === null) return "slug_required";
    if (slugRemovedWhileListed && current.publiclyListed) return "slug_required";
  }
  try {
    const property = await orNullIfMissing(db.property.update({ where: { id }, data: input }));
    // Name and colour show in every calendar window of the property.
    if (property) invalidateWindows(id);
    return property;
  } catch (error) {
    if (input.currency !== undefined && isPrismaError(error, "P2003")) return "currency_locked";
    if (isPrismaError(error, "P2002")) return "slug_taken";
    throw error;
  }
}

/**
 * Archives or restores. Archiving keeps the original time when repeated, so
 * "archived since" stays true. A single conditional update, so concurrent
 * calls cannot overwrite each other's archive time.
 */
export async function setArchived(id: string, archived: boolean): Promise<Property | null> {
  const { count } = await db.property.updateMany({
    where: { id, archivedAt: archived ? null : { not: null } },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (count > 0) invalidateWindows(id);
  return getProperty(id);
}

export type DeleteResult = "deleted" | "not_found" | "has_history";

/**
 * Deletes a property with no history. One that has bookings (or anything else
 * whose relation restricts deletion) is refused: it must be archived instead,
 * so its history stays intact.
 */
export async function deleteProperty(id: string): Promise<DeleteResult> {
  try {
    await db.property.delete({ where: { id } });
    invalidateWindows(id);
    return "deleted";
  } catch (error) {
    if (isPrismaError(error, "P2025")) return "not_found";
    // P2003: a foreign key from a dependent row (a booking or a transaction)
    // refused it.
    if (isPrismaError(error, "P2003")) return "has_history";
    throw error;
  }
}
