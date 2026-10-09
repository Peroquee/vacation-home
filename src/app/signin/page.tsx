import { Home } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeCallbackUrl } from "@/lib/access";
import { signInWithGoogle } from "@/lib/auth-actions";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signin");
  return { title: t("title") };
}

/** Auth.js error codes, as they arrive in `?error=`, with a message of their own. */
const KNOWN_ERRORS = ["AccessDenied", "Verification"] as const;

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { error, callbackUrl } = await searchParams;
  const destination = safeCallbackUrl(callbackUrl);

  if (await getCurrentUser()) redirect(destination);

  const t = await getTranslations("signin");
  const code = Array.isArray(error) ? error[0] : error;
  const known = KNOWN_ERRORS.find((k) => k === code);
  const message = code ? t(`errors.${known ?? "fallback"}`) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Home aria-hidden className="text-brand-500 mb-2 size-6" />
          <CardTitle>
            <h1 className="text-lg">{t("appName")}</h1>
          </CardTitle>
          <CardDescription>{t("intro")}</CardDescription>
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
              {t("button")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
