import Form from "next/form";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/bookings/labels";
import { type ListState, listHref, WHEN, type When } from "@/lib/bookings/list-params";
import { BOOKING_SOURCES, BOOKING_STATUSES } from "@/lib/bookings/schema";
import { cn } from "@/lib/utils";

const WHEN_LABELS: Record<When, string> = { upcoming: "Upcoming", past: "Past", all: "All" };

type PropertyOption = { id: string; name: string; archived: boolean };

/**
 * The list's filters, as a plain GET form: submitting puts them in the URL,
 * so a filtered view survives a reload and works without JavaScript.
 */
export function BookingFilters({
  state,
  properties,
}: {
  state: ListState;
  properties: PropertyOption[];
}) {
  const { params, when } = state;
  const active = properties.filter((p) => !p.archived);
  const archived = properties.filter((p) => p.archived);
  const filtered = ["propertyId", "status", "source", "from", "to", "q"].some(
    (key) => key in params,
  );

  return (
    <div className="mb-4 space-y-3">
      <nav aria-label="Which stays" className="flex gap-1">
        {WHEN.map((option) => (
          <Link
            key={option}
            href={listHref(params, {
              when: option === "upcoming" ? undefined : option,
              sort: undefined,
            })}
            aria-current={option === when ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: option === when ? "secondary" : "ghost", size: "sm" }),
            )}
          >
            {WHEN_LABELS[option]}
          </Link>
        ))}
      </nav>

      <Form action="/bookings" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        {/* Kept across a filter change; sorting and paging start over. */}
        {when !== "upcoming" ? <input type="hidden" name="when" value={when} /> : null}

        <Field className="lg:col-span-2">
          <FieldLabel htmlFor="bookings-q">Guest</FieldLabel>
          <Input
            id="bookings-q"
            name="q"
            type="search"
            placeholder="Name or email"
            defaultValue={params.q}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="bookings-property">Property</FieldLabel>
          <NativeSelect
            id="bookings-property"
            name="propertyId"
            className="w-full"
            defaultValue={params.propertyId ?? ""}
          >
            <NativeSelectOption value="">All properties</NativeSelectOption>
            {active.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
            {/* Archived properties keep their history, so it can be looked up. */}
            {archived.length > 0 ? (
              <NativeSelectOptGroup label="Archived">
                {archived.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ) : null}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="bookings-status">Status</FieldLabel>
          <NativeSelect
            id="bookings-status"
            name="status"
            className="w-full"
            defaultValue={params.status ?? ""}
          >
            <NativeSelectOption value="">Any status</NativeSelectOption>
            {BOOKING_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {STATUS_LABELS[status]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="bookings-source">Source</FieldLabel>
          <NativeSelect
            id="bookings-source"
            name="source"
            className="w-full"
            defaultValue={params.source ?? ""}
          >
            <NativeSelectOption value="">Any source</NativeSelectOption>
            {BOOKING_SOURCES.map((source) => (
              <NativeSelectOption key={source} value={source}>
                {SOURCE_LABELS[source]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1 lg:contents">
          <Field>
            <FieldLabel htmlFor="bookings-from">From</FieldLabel>
            <Input id="bookings-from" name="from" type="date" defaultValue={params.from} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bookings-to">To</FieldLabel>
            <Input id="bookings-to" name="to" type="date" defaultValue={params.to} />
          </Field>
        </div>

        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Apply filters</Button>
          {filtered ? (
            <Link
              href={listHref({}, { when: when === "upcoming" ? undefined : when })}
              className={buttonVariants({ variant: "ghost" })}
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </Form>
    </div>
  );
}
