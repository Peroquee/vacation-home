import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { APP_LOCALE } from "@/lib/locale";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vacation Rental Manager",
  description:
    "Booking calendar, Google Calendar sync and finance tracking for vacation rental properties.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={APP_LOCALE}>
      <body>
        <AppShell>{children}</AppShell>
        {/* Clears the fixed mobile bottom bar (h-16). */}
        <Toaster position="bottom-right" mobileOffset={{ bottom: "5rem" }} />
      </body>
    </html>
  );
}
