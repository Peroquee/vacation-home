/**
 * Current user. Server-side only.
 *
 * TODO(#45): replace the placeholder with the Auth.js session. This is
 * already async and already returns null for the signed-out case, so that
 * swapping in `await auth()` does not change any caller's shape.
 */

export type CurrentUser = {
  name: string;
  email: string;
  /** Avatar URL, or null to fall back to initials. */
  image: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return {
    name: "Placeholder User",
    email: "placeholder@example.com",
    image: null,
  };
}
