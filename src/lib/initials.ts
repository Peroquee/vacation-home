/**
 * Initials for an avatar fallback, e.g. "Ada Lovelace" -> "AL".
 *
 * Deliberately separate from src/lib/session.ts: this is imported by a
 * client component, and session.ts becomes server-only once #45 makes it
 * read the Auth.js session.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
