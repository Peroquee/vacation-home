"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { NAV_ITEMS, isActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation: a fixed bottom bar, so the five destinations stay within
 * thumb reach. Hidden from the md breakpoint up, where the sidebar takes over.
 *
 * The matching `pb-16` on the main content keeps this from covering the last
 * few lines of a scrolled page.
 */
export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("label")}
      className="bg-sidebar fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 44px minimum touch target.
                  "flex min-h-11 flex-col items-center justify-center gap-1 px-1 py-2 text-xs",
                  active
                    ? "text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70",
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className="truncate">{t(label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
