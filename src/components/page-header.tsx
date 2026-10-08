import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary actions for the page, e.g. a "New booking" button. */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * The heading every page starts with: one `h1`, an optional line of context,
 * and the page's primary actions, which wrap below the title on small screens.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn("mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-medium">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
