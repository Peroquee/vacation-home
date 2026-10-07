import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vacation Rental Manager",
  description:
    "Booking calendar, Google Calendar sync and finance tracking for vacation rental properties.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
