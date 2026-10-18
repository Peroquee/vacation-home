/**
 * The signed-in user. Server-side only.
 *
 * The proxy has already turned away requests without a valid session, so
 * inside a page or route handler this is normally non-null.
 */
import { cache } from "react";

import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowed-emails";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  /** Avatar URL, or null to fall back to initials. */
  image: string | null;
};

/** Cached per request, so the shell and the page share one session lookup. */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const user = session?.user;
  // Same rule as the proxy: a valid session for an address since removed
  // from the allow-list does not count. (Disagreeing with the proxy here sent
  // such a session round in a redirect loop via the sign-in page.)
  if (!user?.id || !user.email || !(await isAllowedEmail(user.email))) return null;
  return {
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    image: user.image ?? null,
  };
});
