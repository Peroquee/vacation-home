"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Whether a key press belongs to whatever is being typed into. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=dialog],[role=alertdialog]") !== null
  );
}

/**
 * Press T anywhere in the app to record a transaction: it opens the ledger's
 * quick-add form, keeping the ledger's filters when already there. Ignored
 * while typing, inside dialogs and with a modifier held.
 */
export function QuickAddShortcut() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "t" && event.key !== "T") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      const params = new URLSearchParams(pathname === "/finance" ? searchParams : undefined);
      params.set("add", "1");
      router.push(`/finance?${params}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname, searchParams]);

  return null;
}
