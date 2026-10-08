import { Prisma } from "@/generated/prisma/client";

/**
 * Prisma error codes the services translate into API responses:
 * - P2002: a unique constraint was violated;
 * - P2003: a foreign key refused the change (a dependent row exists);
 * - P2025: the record to update or delete does not exist.
 */
export function isPrismaError(error: unknown, code: "P2002" | "P2003" | "P2025"): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** Runs an update or delete, returning null when the record is missing. */
export async function orNullIfMissing<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    if (isPrismaError(error, "P2025")) return null;
    throw error;
  }
}

/**
 * Whether `error` is PostgreSQL refusing a row under the exclusion constraint
 * `constraint` (SQLSTATE 23P01). Prisma has no code of its own for this; the
 * pg driver adapter passes the original error along in `meta`.
 */
export function isExclusionViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const cause = (error.meta?.driverAdapterError as { cause?: Record<string, unknown> } | undefined)
    ?.cause;
  return (
    cause?.originalCode === "23P01" &&
    typeof cause.originalMessage === "string" &&
    cause.originalMessage.includes(`"${constraint}"`)
  );
}
