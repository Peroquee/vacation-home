import type { Metadata } from "next";
import { connection } from "next/server";

import { Toaster } from "@/components/ui/sonner";
import { APP_LOCALE } from "@/lib/locale";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vacation Rental Manager",
  description:
    "Booking calendar, Google Calendar sync and finance tracking for vacation rental properties.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request, so each gets the fresh CSP nonce that
  // src/proxy.ts sets (a prerendered page would have none, and its scripts
  // would be blocked).
  await connection();
  return (
    <html lang={APP_LOCALE}>
      <body>
        {children}
        {/* Clears the fixed mobile bottom bar (h-16). */}
        <Toaster position="bottom-right" mobileOffset={{ bottom: "5rem" }} />
      </body>
    </html>
  );
}
