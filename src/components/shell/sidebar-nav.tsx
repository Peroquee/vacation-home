"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { NAV_ITEMS, isActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Desktop navigation. Hidden below the md breakpoint, where MobileNav takes over. */
export function SidebarNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav aria-label={t("label")} className="flex flex-1 flex-col gap-1 p-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            // aria-current is what conveys "active" to a screen reader; the
            // colour and weight below are the visual half of the same signal.
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
