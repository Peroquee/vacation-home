"use server";

import { SIGN_IN_PATH, signIn, signOut } from "@/auth";
import { safeCallbackUrl } from "@/lib/access";

/** Starts Google sign-in, returning to `callbackUrl` (a path on this site). */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl")?.toString());
  await signIn("google", { redirectTo: callbackUrl });
}

/** Ends the session (deleting it from the database) and goes to sign-in. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: SIGN_IN_PATH });
}
