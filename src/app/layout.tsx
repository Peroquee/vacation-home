import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vacation Rental Manager",
  description:
    "Booking calendar, Google Calendar sync and finance tracking for vacation rental properties.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
