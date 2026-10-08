/**
 * Ledger categories. Server-side only. The defaults are system categories,
 * created by the migration: renamable, recolourable and hideable, never
 * deletable (the database refuses). User categories can be deleted while
 * no transaction uses them.
 */
import { z } from "zod";

import type { Category } from "@/generated/prisma/client";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { isPrismaError, raisedByDatabase } from "@/lib/db-errors";

export const TRANSACTION_TYPES = ["income", "expense"] as const;

const fields = {
  name: z.string().trim().min(1, "is required").max(60, "must be at most 60 characters"),
  type: z.enum(TRANSACTION_TYPES),
  color: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, "must be a hex colour like #0f766e"),
  hidden: z.boolean(),
};

export const createCategorySchema = z.strictObject({
  name: fields.name,
  type: fields.type,
  color: fields.color.default("#64748b"),
});

/** The type cannot change: transactions follow their category's type. */
export const updateCategorySchema = z
  .strictObject({ name: fields.name, color: fields.color, hidden: fields.hidden })
  .partial()
  .refine((update) => Object.keys(update).length > 0, "at least one field is required");

export type CategoryDto = Omit<Category, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function toDto({ createdAt, updatedAt, ...rest }: Category): CategoryDto {
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

/** By type, then name; hidden ones only when asked. */
export async function listCategories({
  includeHidden = false,
  type,
}: { includeHidden?: boolean; type?: Category["type"] } = {}): Promise<Category[]> {
  return db.category.findMany({
    where: { ...(includeHidden ? {} : { hidden: false }), ...(type && { type }) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

/** The system category with `systemKey`, e.g. "booking_income". */
export async function systemCategory(systemKey: string): Promise<Category> {
  return db.category.findUniqueOrThrow({ where: { systemKey } });
}

/** The 409 for a name another category of the same type already has. */
export function nameTakenResponse(): Response {
  return apiError(409, "conflict", "A category of this type already has that name.", {
    name: ["is already taken"],
  });
}

export type CategoryWrite = { category: Category } | { error: "not_found" | "name_taken" };

export async function createCategory(
  input: z.infer<typeof createCategorySchema>,
): Promise<CategoryWrite> {
  try {
    return { category: await db.category.create({ data: input }) };
  } catch (error) {
    if (isPrismaError(error, "P2002")) return { error: "name_taken" };
    throw error;
  }
}

export async function updateCategory(
  id: string,
  input: z.infer<typeof updateCategorySchema>,
): Promise<CategoryWrite> {
  try {
    return { category: await db.category.update({ where: { id }, data: input }) };
  } catch (error) {
    if (isPrismaError(error, "P2025")) return { error: "not_found" };
    if (isPrismaError(error, "P2002")) return { error: "name_taken" };
    throw error;
  }
}

export type DeleteResult = "deleted" | "not_found" | "system" | "in_use";

/**
 * Deletes a user category no transaction uses. A system category is refused
 * ("system": hide it instead); one in use is refused ("in_use": move its
 * transactions to another category first).
 */
export async function deleteCategory(id: string): Promise<DeleteResult> {
  try {
    await db.category.delete({ where: { id } });
    return "deleted";
  } catch (error) {
    if (isPrismaError(error, "P2025")) return "not_found";
    if (raisedByDatabase(error, "system_category")) return "system";
    if (isPrismaError(error, "P2003")) return "in_use";
    throw error;
  }
}
