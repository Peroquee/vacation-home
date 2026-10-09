/**
 * Property persistence. Server-side only. Route handlers validate input with
 * ./schema and translate the results below into HTTP responses.
 */
import type { Property } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { db } from "@/lib/db";
import { isPrismaError, orNullIfMissing } from "@/lib/db-errors";

import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";

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

export async function createProperty(input: CreatePropertyInput): Promise<Property> {
  return db.property.create({ data: input });
}

/** Null when there is no such property. */
/**
 * Null when there is no such property; "currency_locked" when the currency
 * would change while transactions are recorded in the old one (the
 * database refuses: their amounts are minor units of that currency).
 */
export async function updateProperty(
  id: string,
  input: UpdatePropertyInput,
): Promise<Property | null | "currency_locked"> {
  try {
    const property = await orNullIfMissing(db.property.update({ where: { id }, data: input }));
    // Name and colour show in every calendar window of the property.
    if (property) invalidateWindows(id);
    return property;
  } catch (error) {
    if (input.currency !== undefined && isPrismaError(error, "P2003")) return "currency_locked";
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
