import { CircleAlert, Inbox, type LucideIcon, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StateProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
};

function StateFrame({
  icon: Icon,
  title,
  description,
  children,
  className,
  role,
  tone = "muted",
}: StateProps & {
  icon: LucideIcon;
  children?: React.ReactNode;
  role?: "alert" | "status";
  tone?: "muted" | "destructive";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full",
          tone === "destructive"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon aria-hidden className="size-5" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Shown when a list or page has nothing in it yet. Say what would be here and
 * offer the action that adds the first one.
 */
export function EmptyState({
  icon = Inbox,
  action,
  ...props
}: StateProps & { icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <StateFrame icon={icon} role="status" {...props}>
      {action}
    </StateFrame>
  );
}

/**
 * Shown when loading something failed. Pass `onRetry` from a client
 * component - typically an `error.tsx` boundary's `retry` - to offer a retry.
 */
export function ErrorState({
  title,
  description,
  reference,
  onRetry,
  className,
}: Partial<StateProps> & {
  /** An identifier the user can quote, e.g. Next's error `digest`. */
  reference?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations();
  return (
    <StateFrame
      icon={CircleAlert}
      role="alert"
      tone="destructive"
      title={title ?? t("states.errorTitle")}
      description={description ?? t("states.errorDescription")}
      className={className}
    >
      {reference ? (
        <p className="text-muted-foreground font-mono text-xs">
          {t("states.reference", { reference })}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCw data-icon="inline-start" aria-hidden />
          {t("common.retry")}
        </Button>
      ) : null}
    </StateFrame>
  );
}
