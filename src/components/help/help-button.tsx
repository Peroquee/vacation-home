"use client";

import { CircleHelp } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { helpKeyFor } from "@/lib/help/routes";

// The panel's body - the text and its Markdown renderer - loads when the
// panel first opens, so no page carries it in its first load (GitLab #121).
const HelpBody = dynamic(() => import("./help-body").then((m) => m.HelpBody), { ssr: false });

/**
 * The help button on every owner page (GitLab #121): opens a side panel
 * with the help for the page you are on, in your language.
 */
export function HelpButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("help");
  const pathname = usePathname();
  const key = helpKeyFor(pathname);
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "default"}
            className={compact ? undefined : "w-full justify-start"}
            aria-label={t("buttonLabel")}
          >
            <CircleHelp aria-hidden data-icon={compact ? undefined : "inline-start"} />
            {compact ? null : t("button")}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("panelTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{t("buttonLabel")}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {open ? (
            key ? (
              <HelpBody helpKey={key} onLeave={() => setOpen(false)} />
            ) : (
              <p className="text-sm">{t("none")}</p>
            )
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
