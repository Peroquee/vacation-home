import type { Metadata } from "next";
import { connection } from "next/server";

import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("description") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request, so each gets the fresh CSP nonce that
  // src/proxy.ts sets (a prerendered page would have none, and its scripts
  // would be blocked).
  await connection();
  // The request's language (src/i18n/request.ts), for the page and for the
  // client components, which get its messages from the provider.
  const locale = await getLocale();
  // Less the emails' words (GitLab #111): only the server writes emails.
  // And less the settings' (GitLab #112), the largest part, which only the
  // settings pages use: src/app/(app)/settings/layout.tsx adds it there, so
  // every other page carries some 17 kB less.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
  const { email, settings, ...messages } = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        {/* Clears the fixed mobile bottom bar (h-16). */}
        <Toaster position="bottom-right" mobileOffset={{ bottom: "5rem" }} />
      </body>
    </html>
  );
}
