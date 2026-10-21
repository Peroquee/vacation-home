"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/finance", key: "ledger" },
  { href: "/finance/recurring", key: "recurring" },
  { href: "/finance/tourist-tax", key: "touristTax" },
  { href: "/finance/categories", key: "categories" },
] as const;

/**
 * The parts of Finance as tabs on each of its pages (GitLab #130), so the
 * recurring costs are found without knowing which button leads there.
 * The ledger's own pages (the import) count as the ledger.
 */
export function FinanceTabs() {
  const t = useTranslations("finance.tabs");
  const pathname = usePathname();
  const current =
    TABS.slice(1).find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
      ?.href ?? "/finance";
  return (
    <nav aria-label={t("label")} className="mb-4 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const active = tab.href === current;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 text-sm font-medium",
                  active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
