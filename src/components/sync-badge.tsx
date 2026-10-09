import { CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type SyncState = "synced" | "pending" | "failed" | "dead" | "not_synced";

const STATES: Record<
  Exclude<SyncState, "not_synced">,
  { icon: typeof CircleCheck; tone: string }
> = {
  synced: {
    icon: CircleCheck,
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  pending: { icon: Clock, tone: "text-muted-foreground" },
  failed: { icon: CircleAlert, tone: "text-destructive" },
  dead: { icon: CircleX, tone: "text-destructive" },
};

/**
 * A booking's Google Calendar sync state: an icon and words, never colour
 * alone. Nothing for a booking that is not synced at all (sync off, or not
 * confirmed), so bookings without sync carry no noise.
 */
export function SyncBadge({
  state,
  title,
  className,
}: {
  state: SyncState;
  /** Shown on hover, e.g. the error or when it last synced. */
  title?: string;
  className?: string;
}) {
  const t = useTranslations("syncBadge");
  if (state === "not_synced") return null;
  const { icon: Icon, tone } = STATES[state];
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", tone, className)}
      title={title}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(state)}
    </span>
  );
}
