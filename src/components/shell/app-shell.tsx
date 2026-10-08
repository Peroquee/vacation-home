import Link from "next/link";
import { redirect } from "next/navigation";
import { Home } from "lucide-react";

import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { SIGN_IN_PATH } from "@/auth";
import { getCurrentUser } from "@/lib/session";

/**
 * The frame every page renders inside.
 *
 * Desktop (md and up): a fixed sidebar holding the brand, the navigation and
 * the account menu. Mobile: a top bar for the brand and account, and a fixed
 * bottom bar for navigation, so the primary destinations stay thumb-reachable.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  // The proxy only lets signed-in requests through; this covers a session
  // that ended in between.
  const user = await getCurrentUser();
  if (!user) redirect(SIGN_IN_PATH);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r md:flex">
        <Brand />
        <SidebarNav />
        <div className="border-t p-2">
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="bg-sidebar text-sidebar-foreground sticky top-0 z-30 flex h-14 items-center justify-between border-b px-2 md:hidden">
        <Brand />
        <div className="w-auto max-w-[60%]">
          <UserMenu user={user} />
        </div>
      </header>

      {/* pb-16 clears the fixed bottom bar. pl-68 is 17rem: the 16rem
          sidebar plus a 1rem gutter, so it is deliberately not pl-64. */}
      <main className="px-4 pt-4 pb-16 md:pb-8 md:pl-68">{children}</main>

      <MobileNav />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/calendar" className="flex h-14 shrink-0 items-center gap-2 px-3 font-medium">
      <Home aria-hidden className="text-brand-500 size-5" />
      <span className="truncate">Vacation Rental</span>
    </Link>
  );
}
