import { ArrowDown, ArrowUp, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/bookings/labels";
import { type ListState, listHref, nextSort, parseListParams } from "@/lib/bookings/list-params";
import type { BookingSort } from "@/lib/bookings/schema";
import { type BookingDto, listBookings, toDto } from "@/lib/bookings/service";
import { formatDateRange, formatMoney } from "@/lib/format";
import { listProperties } from "@/lib/properties/service";
import { cn } from "@/lib/utils";

import { BookingFilters } from "./booking-filters";

export const metadata: Metadata = { title: "Bookings" };

/** Where a booking's row leads: its detail page. */
const bookingHref = (b: BookingDto) => `/bookings/${b.id}`;

const FILTER_KEYS = ["propertyId", "status", "source", "from", "to", "q"];

function NewBookingLink() {
  return (
    <Link href="/bookings/new" className={buttonVariants()}>
      New booking
    </Link>
  );
}

/** A column header that sorts by its column and says how it is sorted now. */
function SortHeader({
  state,
  sort,
  column,
  label,
}: {
  state: ListState;
  sort: BookingSort;
  column: string;
  label: string;
}) {
  const direction = sort === column ? "ascending" : sort === `-${column}` ? "descending" : null;
  const Arrow = direction === "descending" ? ArrowDown : ArrowUp;
  return (
    <Link
      href={listHref(state.params, { sort: nextSort(sort, column) })}
      className="inline-flex items-center gap-1 hover:underline"
    >
      {label}
      {direction ? (
        <>
          <Arrow aria-hidden className="size-3.5" />
          <span className="sr-only">, sorted {direction}</span>
        </>
      ) : null}
    </Link>
  );
}

function columns(state: ListState, sort: BookingSort): Column<BookingDto>[] {
  const header = (column: string, label: string) => (
    <SortHeader state={state} sort={sort} column={column} label={label} />
  );
  return [
    {
      id: "checkIn",
      header: header("checkIn", "Dates"),
      cell: (b) => (
        <Link href={bookingHref(b)} className="font-medium hover:underline">
          {formatDateRange(b.checkIn, b.checkOut)}
        </Link>
      ),
    },
    { id: "guest", header: header("guest", "Guest"), cell: (b) => b.guest.name },
    { id: "property", header: header("property", "Property"), cell: (b) => b.property.name },
    {
      id: "status",
      header: header("status", "Status"),
      cell: (b) => (
        <span className={cn(b.status === "cancelled" && "text-muted-foreground line-through")}>
          {STATUS_LABELS[b.status]}
        </span>
      ),
    },
    { id: "source", header: header("source", "Source"), cell: (b) => SOURCE_LABELS[b.source] },
    {
      id: "total",
      header: header("total", "Total"),
      cell: (b) => formatMoney(b.totalAmountMinor, b.currency),
      align: "end",
    },
  ];
}

/** Below the table breakpoint, each booking is a card. */
function BookingCards({ bookings }: { bookings: BookingDto[] }) {
  return (
    <ul className="space-y-2 md:hidden" aria-label="Bookings">
      {bookings.map((b) => (
        <li key={b.id}>
          <Card size="sm">
            <CardContent className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={bookingHref(b)} className="font-medium hover:underline">
                  {formatDateRange(b.checkIn, b.checkOut)}
                </Link>
                <p className="truncate">{b.guest.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {b.property.name} · {STATUS_LABELS[b.status]} · {SOURCE_LABELS[b.source]}
                </p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">
                {formatMoney(b.totalAmountMinor, b.currency)}
              </p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  state,
  page,
  pageSize,
  total,
}: {
  state: ListState;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const link = (to: number, label: string) =>
    to < 1 || to > pages ? (
      <span
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "opacity-50")}
        aria-disabled
      >
        {label}
      </span>
    ) : (
      <Link
        href={listHref(state.params, { page: to === 1 ? undefined : String(to) })}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {label}
      </Link>
    );
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2">
      {link(page - 1, "Previous")}
      <p className="text-muted-foreground text-sm">
        Page {page} of {pages}
      </p>
      {link(page + 1, "Next")}
    </nav>
  );
}

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  const state = parseListParams(await searchParams);
  const properties = (await listProperties({ includeArchived: true })).map((p) => ({
    id: p.id,
    name: p.name,
    archived: p.archivedAt !== null,
  }));
  const filtered = FILTER_KEYS.some((key) => key in state.params);

  const header = (
    <PageHeader
      title="Bookings"
      description="Every stay, across your properties."
      actions={<NewBookingLink />}
    />
  );

  if ("error" in state) {
    return (
      <>
        {header}
        <BookingFilters state={state} properties={properties} />
        <ErrorState
          title="These filters don't work together"
          description={state.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}
        />
      </>
    );
  }

  const { items, total, page, pageSize } = await listBookings(state.query);
  const bookings = items.map(toDto);

  return (
    <>
      {header}
      <BookingFilters state={state} properties={properties} />
      {bookings.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={
            filtered
              ? "No bookings match these filters"
              : state.when === "past"
                ? "No past stays yet"
                : state.when === "upcoming"
                  ? "No upcoming stays"
                  : "No bookings yet"
          }
          description={
            filtered ? "Try fewer filters, or look at all stays." : "Bookings you add show up here."
          }
          action={
            filtered ? (
              <Link
                href={listHref({}, { when: "all" })}
                className={buttonVariants({ variant: "outline" })}
              >
                Show all stays
              </Link>
            ) : (
              <NewBookingLink />
            )
          }
        />
      ) : (
        <>
          <p className="text-muted-foreground mb-2 text-sm">
            {total} {total === 1 ? "booking" : "bookings"}
          </p>
          <div className="hidden md:block">
            <DataTable
              caption="Bookings"
              columns={columns(state, state.query.sort)}
              rows={bookings}
              rowKey={(b) => b.id}
              empty={null}
            />
          </div>
          <BookingCards bookings={bookings} />
          <Pagination state={state} page={page} pageSize={pageSize} total={total} />
        </>
      )}
    </>
  );
}
