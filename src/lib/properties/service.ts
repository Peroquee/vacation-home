/**
 * Property persistence. Server-side only. Route handlers validate input with
 * ./schema and translate the results below into HTTP responses.
 */
import { Prisma, type Property } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";

/** The API's view of a property: `archived` spelled out alongside its time. */
export type PropertyDto = Omit<Property, "archivedAt" | "createdAt" | "updatedAt"> & {
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toDto(property: Property): PropertyDto {
  const { archivedAt, createdAt, updatedAt, ...rest } = property;
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
export async function updateProperty(
  id: string,
  input: UpdatePropertyInput,
): Promise<Property | null> {
  return orNullIfMissing(db.property.update({ where: { id }, data: input }));
}

/**
 * Archives or restores. Archiving keeps the original time when repeated, so
 * "archived since" stays true. A single conditional update, so concurrent
 * calls cannot overwrite each other's archive time.
 */
export async function setArchived(id: string, archived: boolean): Promise<Property | null> {
  await db.property.updateMany({
    where: { id, archivedAt: archived ? null : { not: null } },
    data: { archivedAt: archived ? new Date() : null },
  });
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
    return "deleted";
  } catch (error) {
    if (isPrismaError(error, "P2025")) return "not_found";
    // P2003: a foreign key from a dependent row (a booking) refused it.
    if (isPrismaError(error, "P2003")) return "has_history";
    throw error;
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function orNullIfMissing<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    // P2025: the record to update no longer exists.
    if (isPrismaError(error, "P2025")) return null;
    throw error;
  }
}
