/**
 * Loading placeholders shaped like the content they stand in for, so the
 * page does not jump when it arrives. Use them in `loading.tsx` files and
 * Suspense fallbacks.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The one live region per skeleton, announcing the loading state to screen
 * readers. Skeletons compose from the unannounced parts, never from each
 * other, so regions do not nest.
 */
function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} aria-busy className={className}>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2" aria-hidden>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

type TableShape = { rows?: number; columns?: number };

/** The table's shape alone, with no live region of its own. */
function TableBones({ rows = 5, columns = 4 }: TableShape) {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ className, ...shape }: TableShape & { className?: string }) {
  return (
    <Loading label="Loading table" className={className}>
      <TableBones {...shape} />
    </Loading>
  );
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Loading label="Loading" className={className}>
      <Card aria-hidden>
        <CardHeader>
          <Skeleton className="h-5 w-1/3" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
          ))}
        </CardContent>
      </Card>
    </Loading>
  );
}

/** A whole page: header plus a table. The default for a `loading.tsx`. */
export function PageSkeleton() {
  return (
    <Loading label="Loading page">
      <PageHeaderSkeleton />
      <TableBones />
    </Loading>
  );
}
