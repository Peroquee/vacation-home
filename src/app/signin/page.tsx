import { Home } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeCallbackUrl } from "@/lib/access";
import { signInWithGoogle } from "@/lib/auth-actions";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

/** Auth.js error codes, as they arrive in `?error=`, in plain words. */
const MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Google account isn't allowed to use this app. Sign in with an account the owner has added, or ask them to add yours.",
  Verification: "That sign-in link has expired. Please sign in again.",
};
const FALLBACK_MESSAGE = "Signing in didn't work. Please try again.";

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { error, callbackUrl } = await searchParams;
  const destination = safeCallbackUrl(callbackUrl);

  if (await getCurrentUser()) redirect(destination);

  const code = Array.isArray(error) ? error[0] : error;
  const message = code ? (MESSAGES[code] ?? FALLBACK_MESSAGE) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Home aria-hidden className="text-brand-500 mb-2 size-6" />
          <CardTitle>
            <h1 className="text-lg">Vacation Rental</h1>
          </CardTitle>
          <CardDescription>Sign in with your Google account to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-control px-3 py-2 text-sm"
            >
              {message}
            </p>
          ) : null}
          <form action={signInWithGoogle}>
            <input type="hidden" name="callbackUrl" value={destination} />
            <Button type="submit" className="w-full">
              Sign in with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
