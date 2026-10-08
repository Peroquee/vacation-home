/**
 * Escapes text for Prisma's `contains` / `startsWith`, which become SQL LIKE
 * without escaping: `%` and `_` typed by a user would otherwise be wildcards.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}
