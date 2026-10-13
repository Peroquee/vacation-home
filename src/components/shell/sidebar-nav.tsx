"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { type NavBadges, NAV_ITEMS, isActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** A count next to a nav entry: things waiting there. Read out as "3 waiting". */
export function Badge({ count, className }: { count?: number; className?: string }) {
  const t = useTranslations("nav");
  if (!count) return null;
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-xs font-medium tabular-nums",
        className,
      )}
    >
      {count}
      <span className="sr-only"> {t("waiting")}</span>
    </span>
  );
}

/** Desktop navigation. Hidden below the md breakpoint, where MobileNav takes over. */
export function SidebarNav({ badges = {} }: { badges?: NavBadges }) {
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
            <Badge count={badges[label]} />
          </Link>
        );
      })}
    </nav>
  );
}
