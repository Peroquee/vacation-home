/** Guest persistence. Server-side only. */
import type { Guest } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isPrismaError } from "@/lib/db-errors";
import { escapeLike } from "@/lib/like";

import type { CreateGuestInput, UpdateGuestInput } from "./schema";

export type GuestDto = Omit<Guest, "createdAt" | "updatedAt" | "purgedAt"> & {
  /** Personal data erased; see src/lib/guests/purge.ts. Read-only. */
  purged: boolean;
  purgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toDto({ createdAt, updatedAt, purgedAt, ...rest }: Guest): GuestDto {
  return {
    ...rest,
    purged: purgedAt !== null,
    purgedAt: purgedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/**
 * Guests whose name or email contains `query`, case-insensitively, by name -
 * the typeahead in the booking form. Without a query, the first guests by
 * name.
 */
export async function searchGuests(query: string | undefined, limit: number): Promise<Guest[]> {
  // Prisma's `contains` becomes SQL LIKE without escaping, so `%` and `_`
  // in what the user typed would act as wildcards.
  const text = query === undefined ? undefined : escapeLike(query);
  return db.guest.findMany({
    where: {
      // Purged guests are never offered: not in search, not in the typeahead.
      purgedAt: null,
      ...(text && {
        OR: [
          { name: { contains: text, mode: "insensitive" } },
          { email: { contains: text, mode: "insensitive" } },
        ],
      }),
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export async function getGuest(id: string): Promise<Guest | null> {
  return db.guest.findUnique({ where: { id } });
}

/**
 * Creates a guest, unless one with the same email exists: then that guest is
 * returned unchanged, so creating a guest inline from a booking never
 * duplicates a returning one. Safe under concurrency - the unique index
 * decides, and the loser of a race gets the winner's record.
 */
export async function findOrCreateGuest(
  input: CreateGuestInput,
): Promise<{ guest: Guest; created: boolean }> {
  // Twice at most: a create that loses a race normally finds the winner; if
  // the winner vanished again in between (deleted, email changed), the
  // second create simply succeeds.
  for (let attempt = 1; ; attempt++) {
    if (input.email) {
      const existing = await db.guest.findUnique({ where: { email: input.email } });
      if (existing) return { guest: existing, created: false };
    }
    try {
      return { guest: await db.guest.create({ data: input }), created: true };
    } catch (error) {
      if (!(input.email && isPrismaError(error, "P2002") && attempt < 2)) throw error;
    }
  }
}

export type UpdateResult = { guest: Guest } | { error: "not_found" | "email_taken" | "purged" };

/** Updates a guest; a purged guest is read-only. */
export async function updateGuest(id: string, input: UpdateGuestInput): Promise<UpdateResult> {
  try {
    // Conditional on not being purged, so a purge cannot be undone by an
    // edit that raced it.
    return { guest: await db.guest.update({ where: { id, purgedAt: null }, data: input }) };
  } catch (error) {
    if (isPrismaError(error, "P2025")) {
      const exists = await db.guest.findUnique({ where: { id }, select: { id: true } });
      return { error: exists ? "purged" : "not_found" };
    }
    if (isPrismaError(error, "P2002")) return { error: "email_taken" };
    throw error;
  }
}

export type DeleteResult = "deleted" | "not_found" | "has_history";

/** Deletes a guest with no bookings; one with bookings is refused. */
export async function deleteGuest(id: string): Promise<DeleteResult> {
  try {
    await db.guest.delete({ where: { id } });
    return "deleted";
  } catch (error) {
    if (isPrismaError(error, "P2025")) return "not_found";
    if (isPrismaError(error, "P2003")) return "has_history";
    throw error;
  }
}
