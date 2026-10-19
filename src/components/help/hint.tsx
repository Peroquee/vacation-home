"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

/**
 * A "?" next to something people often get stuck on (GitLab #121): opens a
 * short explanation right below, and closes again. A plain toggle, so it
 * works by keyboard and screen readers announce whether it is open.
 */
export function Hint({ children, label }: { children: React.ReactNode; label?: string }) {
  const t = useTranslations("help");
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground ms-1 inline-flex size-5 items-center justify-center rounded-full align-middle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label ?? t("hint")}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp aria-hidden className="size-4" />
      </button>
      <span
        id={id}
        hidden={!open}
        className="bg-muted text-foreground mt-1 block rounded-md p-2 text-sm font-normal"
      >
        {children}
      </span>
    </>
  );
}
