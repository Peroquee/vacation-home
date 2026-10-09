"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { AgendaItem } from "@/lib/calendar/agenda";
import type { MonthKey } from "@/lib/calendar/month";
import { formatDateRange } from "@/lib/format";
import { APP_LOCALE } from "@/lib/locale";
import { cn } from "@/lib/utils";

/**
 * The calendar as a list, for phones: one group per month, each stay or
 * block a full-width row that opens it on tap. Scrolling near the end loads
 * the next month (`onLoadMore`); the button at the end does the same for a
 * keyboard or a screen reader, so nothing depends on scrolling.
 */
export function Agenda({
  months,
  onOpen,
  onLoadMore,
  loading = false,
  className,
}: {
  months: { month: MonthKey; items: AgendaItem[] }[];
  onOpen: (item: AgendaItem) => void;
  onLoadMore: () => void;
  loading?: boolean;
  className?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const title = new Intl.DateTimeFormat(APP_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Infinite scroll: the next month loads as the end comes into view.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loading) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onLoadMore, loading]);

  return (
    <section aria-label="Agenda" className={cn("space-y-6", className)}>
      {months.map(({ month, items }) => (
        <div key={month}>
          <h3 className="text-muted-foreground mb-2 text-sm font-medium">
            {title.format(new Date(`${month}-01T00:00:00Z`))}
          </h3>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing booked or blocked.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="hover:bg-muted/50 focus-visible:ring-ring flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2"
                  >
                    <span
                      aria-hidden
                      className={cn("h-8 w-1 shrink-0 rounded-full")}
                      style={
                        item.kind === "block"
                          ? {
                              backgroundImage:
                                "repeating-linear-gradient(135deg, var(--muted-foreground) 0 2px, transparent 2px 4px)",
                            }
                          : { backgroundColor: item.property.color }
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.kind === "booking"
                          ? item.booking.guest.name
                          : `Blocked${item.block.reason ? `: ${item.block.reason}` : ""}`}
                      </span>
                      <span className="text-muted-foreground block truncate text-sm">
                        {formatDateRange(item.start, item.end)} · {item.property.name}
                        {item.kind === "booking" && item.booking.status === "inquiry"
                          ? " · inquiry"
                          : ""}
                        {item.kind === "block" && item.block.origin === "google"
                          ? " · from Google Calendar"
                          : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div ref={sentinel} className="flex justify-center">
        <Button variant="outline" onClick={onLoadMore} disabled={loading} aria-busy={loading}>
          {loading ? "Loading…" : "Show next month"}
        </Button>
      </div>
    </section>
  );
}
