/**
 * Loading placeholders shaped like the content they stand in for, so the
 * page does not jump when it arrives. Use them in `loading.tsx` files and
 * Suspense fallbacks.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Announces the loading state once, for screen readers. */
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

export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <Loading label="Loading table" className={cn("space-y-3", className)}>
      <div className="flex gap-4 border-b pb-3" aria-hidden>
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4" aria-hidden>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
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
      <TableSkeleton />
    </Loading>
  );
}
