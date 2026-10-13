import { ArrowDown, ArrowUp, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { SyncBadge, type SyncState } from "@/components/sync-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type Formatters } from "@/i18n/format";
import { getApiText } from "@/i18n/get-api-text";
import { getFormat } from "@/i18n/get-format";
import { SOURCE_KEYS } from "@/lib/bookings/labels";
import { type ListState, listHref, nextSort, parseListParams } from "@/lib/bookings/list-params";
import type { BookingSort } from "@/lib/bookings/schema";
import { type BookingDto, listBookings, toDto } from "@/lib/bookings/service";
import { bookingSyncStatus } from "@/lib/google/sync-status";
import { listProperties } from "@/lib/properties/service";
import { countOpenRequests } from "@/lib/booking-requests/inbox";
import { cn } from "@/lib/utils";

import { BookingFilters } from "./booking-filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings.list");
  return { title: t("title") };
}

type Translate = Awaited<ReturnType<typeof getTranslations<"bookings">>>;

/** Where a booking's row leads: its detail page. */
const bookingHref = (b: BookingDto) => `/bookings/${b.id}`;

const FILTER_KEYS = ["propertyId", "status", "source", "from", "to", "q"];

function NewBookingLink() {
  const t = useTranslations("bookings.list");
  return (
    <Link href="/bookings/new" className={buttonVariants()}>
      {t("new")}
    </Link>
  );
}

/** The inbox of requests from the public site (GitLab #110), with how many wait. */
function RequestsLink({ open }: { open: number }) {
  const t = useTranslations("bookings.list");
  return (
    <Link href="/bookings/requests" className={buttonVariants({ variant: "outline" })}>
      {t("requests")}
      {open > 0 ? ` (${open})` : null}
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
  const t = useTranslations("bookings.list");
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
          <span className="sr-only">{t(`sorted.${direction}`)}</span>
        </>
      ) : null}
    </Link>
  );
}

function columns(
  state: ListState,
  sort: BookingSort,
  sync: Record<string, { state: SyncState; error: string | null }>,
  t: Translate,
  format: Formatters,
  apiText: (message: string) => string,
): Column<BookingDto>[] {
  const header = (column: string, label: string) => (
    <SortHeader state={state} sort={sort} column={column} label={label} />
  );
  return [
    {
      id: "checkIn",
      header: header("checkIn", t("list.columns.dates")),
      cell: (b) => (
        <Link href={bookingHref(b)} className="font-medium hover:underline">
          {format.dateRange(b.checkIn, b.checkOut)}
        </Link>
      ),
    },
    { id: "guest", header: header("guest", t("list.columns.guest")), cell: (b) => b.guest.name },
    {
      id: "property",
      header: header("property", t("list.columns.property")),
      cell: (b) => b.property.name,
    },
    {
      id: "status",
      header: header("status", t("list.columns.status")),
      cell: (b) => (
        <span className={cn(b.status === "cancelled" && "text-muted-foreground line-through")}>
          {t(`status.${b.status}`)}
        </span>
      ),
    },
    {
      id: "source",
      header: header("source", t("list.columns.source")),
      cell: (b) => t(`source.${SOURCE_KEYS[b.source]}`),
    },
    // Only when some booking on the page syncs to Google Calendar.
    ...(Object.values(sync).some((s) => s.state !== "not_synced")
      ? [
          {
            id: "sync",
            header: t("list.columns.google"),
            cell: (b: BookingDto) =>
              sync[b.id] ? (
                <SyncBadge
                  state={sync[b.id]!.state}
                  title={sync[b.id]!.error ? apiText(sync[b.id]!.error!) : undefined}
                />
              ) : null,
          },
        ]
      : []),
    {
      id: "total",
      header: header("total", t("list.columns.total")),
      cell: (b) => format.money(b.totalAmountMinor, b.currency),
      align: "end",
    },
  ];
}

/** Below the table breakpoint, each booking is a card. */
function BookingCards({ bookings, format }: { bookings: BookingDto[]; format: Formatters }) {
  const t = useTranslations("bookings");
  return (
    <ul className="space-y-2 md:hidden" aria-label={t("list.title")}>
      {bookings.map((b) => (
        <li key={b.id}>
          <Card size="sm">
            <CardContent className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={bookingHref(b)} className="font-medium hover:underline">
                  {format.dateRange(b.checkIn, b.checkOut)}
                </Link>
                <p className="truncate">{b.guest.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {b.property.name} · {t(`status.${b.status}`)} ·{" "}
                  {t(`source.${SOURCE_KEYS[b.source]}`)}
                </p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">
                {format.money(b.totalAmountMinor, b.currency)}
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
  const t = useTranslations("bookings.list");
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
    <nav aria-label={t("pages")} className="mt-4 flex items-center justify-between gap-2">
      {link(page - 1, t("previous"))}
      <p className="text-muted-foreground text-sm">{t("pageOf", { page, pages })}</p>
      {link(page + 1, t("next"))}
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
  const t = await getTranslations("bookings");
  const format = await getFormat();
  const apiText = await getApiText();

  const header = (
    <PageHeader
      title={t("list.title")}
      description={t("list.description")}
      actions={
        <>
          <RequestsLink open={await countOpenRequests()} />
          <NewBookingLink />
        </>
      }
    />
  );

  if ("error" in state) {
    return (
      <>
        {header}
        <BookingFilters state={state} properties={properties} />
        <ErrorState
          title={t("list.badFilters")}
          description={state.error.issues
            .map((issue) => `${issue.path.join(".")} ${apiText(issue.message)}`)
            .join("; ")}
        />
      </>
    );
  }

  const { items, total, page, pageSize } = await listBookings(state.query);
  const bookings = items.map(toDto);
  const sync = bookings.length > 0 ? await bookingSyncStatus(bookings.map((b) => b.id)) : {};

  return (
    <>
      {header}
      <BookingFilters state={state} properties={properties} />
      {bookings.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={
            filtered
              ? t("list.noMatch")
              : state.when === "past"
                ? t("list.noPast")
                : state.when === "upcoming"
                  ? t("list.noUpcoming")
                  : t("list.none")
          }
          description={filtered ? t("list.tryFewer") : t("list.showUp")}
          action={
            filtered ? (
              <Link
                href={listHref({}, { when: "all" })}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("list.showAll")}
              </Link>
            ) : (
              <NewBookingLink />
            )
          }
        />
      ) : (
        <>
          <p className="text-muted-foreground mb-2 text-sm">{t("list.count", { count: total })}</p>
          <div className="hidden md:block">
            <DataTable
              caption={t("list.title")}
              columns={columns(state, state.query.sort, sync, t, format, apiText)}
              rows={bookings}
              rowKey={(b) => b.id}
              empty={null}
            />
          </div>
          <BookingCards bookings={bookings} format={format} />
          <Pagination state={state} page={page} pageSize={pageSize} total={total} />
        </>
      )}
    </>
  );
}
