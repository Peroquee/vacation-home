# Shared UI primitives

Every feature page is built from these, so that pages look and behave the same
and nobody invents their own empty state. If a page needs something that is not
here, add it here rather than in the feature.

See them all rendered at **`/dev/ui`** while `npm run dev` is running. That page
is development-only and returns 404 in production.

| Need                      | Use                                                               | From                          |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Page title and actions    | `PageHeader`                                                      | `@/components/page-header`    |
| Grouped content           | `Card` and its parts                                              | `@/components/ui/card`        |
| List of records           | `DataTable`                                                       | `@/components/data-table`     |
| Short focused form        | `Dialog` (modal)                                                  | `@/components/ui/dialog`      |
| Form fields               | `Field`, `FieldLabel`, `FieldError`, `Input`, `NativeSelect`      | `@/components/ui/field`, ...  |
| Search and pick a record  | `Combobox`                                                        | `@/components/ui/combobox`    |
| Month of stays            | `MonthCalendar` (controlled: data and callbacks in props)         | `@/components/calendar/...`   |
| Detail view beside a list | `Sheet`                                                           | `@/components/ui/sheet`       |
| "Are you sure?"           | `ConfirmDialog`                                                   | `@/components/confirm-dialog` |
| Nothing to show yet       | `EmptyState`                                                      | `@/components/states`         |
| Loading failed            | `ErrorState`                                                      | `@/components/states`         |
| Still loading             | `PageSkeleton`, `TableSkeleton`, `CardSkeleton`                   | `@/components/skeletons`      |
| Feedback after an action  | `toastSuccess`, `toastError`                                      | `@/components/toast`          |
| A headline figure         | `StatTile` (value, change vs a named period); `StatTilesSkeleton` | `@/components/stat-tile`      |
| Money and dates           | `formatMoney`, `formatDate`, `formatDateRange`, `formatDateTime`  | `@/lib/format`                |

`components/ui/` holds the shadcn/ui building blocks (on Base UI), added with
`npx shadcn add <name>`. The files one level up compose them into the
app-specific primitives above. Prefer those; reach into `ui/` for the parts
they do not cover.

## PageHeader

One per page. Renders the page's only `h1`.

```tsx
<PageHeader
  title="Bookings"
  description="All stays across your properties."
  actions={
    <Link href="/bookings/new" className={buttonVariants()}>
      New booking
    </Link>
  }
/>
```

A link that looks like a button is a `Link` styled with `buttonVariants`, not a
`Button`, so it navigates (and prefetches) like any other link.

## Card

```tsx
<Card>
  <CardHeader>
    <CardTitle>Occupancy</CardTitle>
    <CardDescription>July 2026</CardDescription>
  </CardHeader>
  <CardContent>74%</CardContent>
</Card>
```

`<Card size="sm">` tightens the spacing for dense grids.

## DataTable

Read-only, and not a client component, so a server component can pass `cell`
functions directly. Give it the empty state to show when there are no rows.
Money and other numbers go in `align: "end"` columns, which also switch on
tabular figures so the digits line up.

```tsx
const columns: Column<Booking>[] = [
  { id: "guest", header: "Guest", cell: (b) => b.guestName },
  { id: "stay", header: "Stay", cell: (b) => formatDateRange(b.checkIn, b.checkOut) },
  {
    id: "total",
    header: "Total",
    cell: (b) => formatMoney(b.totalMinor, b.currency),
    align: "end",
  },
];

<DataTable
  caption="Bookings"
  columns={columns}
  rows={bookings}
  rowKey={(b) => b.id}
  empty={<EmptyState title="No bookings yet" action={<NewBookingButton />} />}
/>;
```

Sorting, filtering and pagination belong in the URL's search params and the
database query, not in the table.

## Dialog and Sheet

Use a `Dialog` for short forms that need the user's full attention, and a
`Sheet` for details that are read beside the list they came from. Both take
their trigger through `render`:

```tsx
<Dialog>
  <DialogTrigger render={<Button>Edit</Button>} />
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit booking</DialogTitle>
      <DialogDescription>Changes are saved immediately.</DialogDescription>
    </DialogHeader>
    {/* form */}
  </DialogContent>
</Dialog>

<Sheet>
  <SheetTrigger render={<Button variant="outline">Details</Button>} />
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Booking details</SheetTitle>
    </SheetHeader>
  </SheetContent>
</Sheet>
```

## Form fields

`Field` wraps one label, control, description and error. Mark it invalid with
`data-invalid` and the control with `aria-invalid`, and show the API's 422
`fields` messages through `FieldError`. Use `NativeSelect` for long standard
lists (timezones, currencies): it is keyboard- and mobile-friendly for free.

```tsx
<Field data-invalid={errors.name ? true : undefined}>
  <FieldLabel htmlFor="name">Name</FieldLabel>
  <Input id="name" aria-invalid={errors.name ? true : undefined} />
  <FieldDescription>Shown on the calendar.</FieldDescription>
  <FieldError errors={errors.name?.map((message) => ({ message }))} />
</Field>
```

`Input` comes from `@/components/ui/input`, `NativeSelect` and
`NativeSelectOption` from `@/components/ui/native-select`. The property form
(`src/app/(app)/settings/property-form-dialog.tsx`) is a complete example.

Also in `components/ui/`: `Textarea` for free text, `Checkbox` for a yes/no
option (label it with a `FieldLabel` in a horizontal `Field`), and `Combobox`
for picking a record from a server-side search, with `filter={null}` so the
server's results are shown as they are. The guest picker in the booking form
(`src/app/(app)/bookings/guest-picker.tsx`) shows the async pattern.

## ConfirmDialog

For anything that cannot be undone. `onConfirm` may return a promise. While it
is pending, both buttons are disabled and the dialog cannot be dismissed. It
closes when the promise resolves. If the promise rejects, the dialog stays open
and the error appears as a toast, so the user can retry or cancel.

```tsx
"use client";

<ConfirmDialog
  trigger={<Button variant="destructive">Cancel booking</Button>}
  title="Cancel this booking?"
  description="The guest is not notified automatically."
  confirmLabel="Cancel booking"
  cancelLabel="Keep booking"
  destructive
  onConfirm={async () => {
    await cancelBooking(booking.id);
    toastSuccess("Booking cancelled");
  }}
/>;
```

To open it from code instead, say after a request comes back refused, leave
out `trigger` and control it with `open` and `onOpenChange`:

```tsx
<ConfirmDialog
  open={inUse}
  onOpenChange={setInUse}
  title="This category is in use"
  confirmLabel="Move and delete"
  onConfirm={moveAndDelete}
/>
```

## EmptyState and ErrorState

`EmptyState` says what would be here and offers the action that adds the first
one. `ErrorState` is for content that failed to load; it is announced to screen
readers as an alert.

```tsx
<EmptyState
  icon={CalendarDays}            // optional, defaults to an inbox
  title="No bookings yet"
  description="Bookings you add or import from Google Calendar show up here."
  action={<Button>New booking</Button>}
/>

<ErrorState description="The bookings could not be loaded." onRetry={retry} />
```

A route segment's `error.tsx` gets `retry` from Next. The root one
([`src/app/error.tsx`](../app/error.tsx)) already renders `ErrorState` with it;
add a nested `error.tsx` only when a section needs a more specific message.

## Skeletons

Shaped like the content they stand in for, so nothing jumps when it arrives.
Each announces "Loading" to screen readers once.

```tsx
// app/bookings/loading.tsx
export default function Loading() {
  return <PageSkeleton />; // header + table
}

<Suspense fallback={<TableSkeleton rows={5} columns={4} />}>
  <BookingsTable />
</Suspense>

<Suspense fallback={<CardSkeleton lines={2} />}>
  <OccupancyCard />
</Suspense>
```

A `loading.tsx` or a suspended component starts streaming the response with
status 200, and **the status cannot change after that**. A `notFound()` that
runs later still shows the not-found page, but as a soft 404 with status 200.
So on pages that look a record up (`/bookings/[id]`), do the lookup and
`notFound()` in the page itself before anything suspends, and wrap only the
slow parts in `<Suspense>`. Don't add a `loading.tsx` to that segment. This is
also why there is no root `loading.tsx`.

## Toasts

For the outcome of something the user just did. The `<Toaster />` is mounted
once in the root layout. Call these from client components:

```tsx
toastSuccess("Booking saved");
toastSuccess("Booking saved", "Synced to Google Calendar.");

try {
  await save();
} catch (error) {
  toastError(error, "Could not save the booking"); // error.message becomes the detail
}
```

Use `toast` (re-exported from sonner) for anything else, such as
`toast.promise`. Don't use a toast for an error that leaves the page empty; use
`ErrorState` there.

## Formatting money and dates

Everything is formatted in the app's locale, `NEXT_PUBLIC_APP_LOCALE` (default
`en-US`). It is inlined when the app is built, so changing it means rebuilding,
and an unsupported value fails `next dev` / `next build`. Currency and timezone
are per property, so they are always passed in.

**Money is stored and passed around as integer minor units** (cents, pence),
never as floats. The currency decides how many minor digits there are:

```ts
formatMoney(123450, "EUR"); // "€1,234.50"
formatMoney(1500, "JPY"); // "¥1,500"  (no minor unit)
formatMoney(12.5, "USD"); // throws: not an integer
```

**Check-in and check-out are calendar dates**, `"YYYY-MM-DD"` strings with no
time or zone. Formatting them through a `Date` in the viewer's timezone would
show the wrong day for anyone west of UTC, so the helpers never do:

```ts
formatDate("2026-07-14"); // "Jul 14, 2026"
formatDate("2026-07-14", { style: "full" }); // "Tuesday, July 14, 2026"
formatDateRange("2026-07-14", "2026-07-18"); // "Jul 14 – 18, 2026"
```

**Instants** (sync times, payment timestamps) are shown in the property's
timezone:

```ts
formatDateTime(syncedAt, property.timezone); // "Jul 14, 2026, 11:30 PM"
```

Every helper takes `{ locale }` to override the configured locale, which is
mainly useful in tests.
