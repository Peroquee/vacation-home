import { Suspense } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { QuickAddShortcut } from "@/components/shell/quick-add-shortcut";
import { SyncAlertBanner } from "@/components/shell/sync-alert-banner";

/** Every signed-in page renders inside the shell; the sign-in page does not. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      {/* Reads the URL, so it must not hold up static rendering. */}
      <Suspense fallback={null}>
        <QuickAddShortcut />
      </Suspense>
      {/* Its own boundary, so a slow check never holds up the page. */}
      <Suspense fallback={null}>
        <SyncAlertBanner />
      </Suspense>
      {children}
    </AppShell>
  );
}
