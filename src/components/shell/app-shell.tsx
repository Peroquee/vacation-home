import Link from "next/link";
import { Home } from "lucide-react";

import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { getCurrentUser } from "@/lib/session";

/**
 * The frame every page renders inside.
 *
 * Desktop (md and up): a fixed sidebar holding the brand, the navigation and
 * the account menu. Mobile: a top bar for the brand and account, and a fixed
 * bottom bar for navigation, so the primary destinations stay thumb-reachable.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r md:flex">
        <Brand />
        <SidebarNav />
        {user ? (
          <div className="border-t p-2">
            <UserMenu user={user} />
          </div>
        ) : (
          <SignInPrompt />
        )}
      </aside>

      {/* Mobile top bar */}
      <header className="bg-sidebar text-sidebar-foreground sticky top-0 z-30 flex h-14 items-center justify-between border-b px-2 md:hidden">
        <Brand />
        {user ? (
          <div className="w-auto max-w-[60%]">
            <UserMenu user={user} />
          </div>
        ) : (
          <SignInPrompt />
        )}
      </header>

      {/* pb-16 clears the fixed bottom bar; md:pl-64 clears the sidebar. */}
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

function SignInPrompt() {
  return (
    <div className="p-2">
      <Link
        href="/api/auth/signin"
        className="hover:bg-sidebar-accent/50 block rounded-control px-3 py-2 text-sm"
      >
        Sign in
      </Link>
    </div>
  );
}
