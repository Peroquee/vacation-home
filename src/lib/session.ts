/**
 * Current user.
 *
 * TODO(#45): replace the placeholder with the Auth.js session. The shell is
 * built against this one function precisely so that wiring real authentication
 * touches nothing else - #45 only has to make `getCurrentUser` read the
 * session and return `null` when there isn't one.
 */

export type CurrentUser = {
  name: string;
  email: string;
  /** Avatar URL, or null to fall back to initials. */
  image: string | null;
};

export function getCurrentUser(): CurrentUser | null {
  return {
    name: "Placeholder User",
    email: "placeholder@example.com",
    image: null,
  };
}

/** Initials for the avatar fallback, e.g. "Ada Lovelace" -> "AL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
