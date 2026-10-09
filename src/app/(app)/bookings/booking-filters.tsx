import Form from "next/form";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { SOURCE_KEYS } from "@/lib/bookings/labels";
import { type ListState, listHref, WHEN } from "@/lib/bookings/list-params";
import { BOOKING_SOURCES, BOOKING_STATUSES } from "@/lib/bookings/schema";
import { cn } from "@/lib/utils";

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
  const t = useTranslations("bookings.filters");
  const tBookings = useTranslations("bookings");
  const { params, when } = state;
  const active = properties.filter((p) => !p.archived);
  const archived = properties.filter((p) => p.archived);
  const filtered = ["propertyId", "status", "source", "from", "to", "q"].some(
    (key) => key in params,
  );

  return (
    <div className="mb-4 space-y-3">
      <nav aria-label={t("whichStays")} className="flex gap-1">
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
            {t(`when.${option}`)}
          </Link>
        ))}
      </nav>

      <Form action="/bookings" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        {/* Kept across a filter change; sorting and paging start over. */}
        {when !== "upcoming" ? <input type="hidden" name="when" value={when} /> : null}

        <Field className="lg:col-span-2">
          <FieldLabel htmlFor="bookings-q">{t("guest")}</FieldLabel>
          <Input
            id="bookings-q"
            name="q"
            type="search"
            placeholder={t("guestPlaceholder")}
            defaultValue={params.q}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="bookings-property">{t("property")}</FieldLabel>
          <NativeSelect
            id="bookings-property"
            name="propertyId"
            className="w-full"
            defaultValue={params.propertyId ?? ""}
          >
            <NativeSelectOption value="">{t("allProperties")}</NativeSelectOption>
            {active.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
            {/* Archived properties keep their history, so it can be looked up. */}
            {archived.length > 0 ? (
              <NativeSelectOptGroup label={t("archived")}>
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
          <FieldLabel htmlFor="bookings-status">{t("status")}</FieldLabel>
          <NativeSelect
            id="bookings-status"
            name="status"
            className="w-full"
            defaultValue={params.status ?? ""}
          >
            <NativeSelectOption value="">{t("anyStatus")}</NativeSelectOption>
            {BOOKING_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {tBookings(`status.${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="bookings-source">{t("source")}</FieldLabel>
          <NativeSelect
            id="bookings-source"
            name="source"
            className="w-full"
            defaultValue={params.source ?? ""}
          >
            <NativeSelectOption value="">{t("anySource")}</NativeSelectOption>
            {BOOKING_SOURCES.map((source) => (
              <NativeSelectOption key={source} value={source}>
                {tBookings(`source.${SOURCE_KEYS[source]}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1 lg:contents">
          <Field>
            <FieldLabel htmlFor="bookings-from">{t("from")}</FieldLabel>
            <Input id="bookings-from" name="from" type="date" defaultValue={params.from} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bookings-to">{t("to")}</FieldLabel>
            <Input id="bookings-to" name="to" type="date" defaultValue={params.to} />
          </Field>
        </div>

        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">{t("apply")}</Button>
          {filtered ? (
            <Link
              href={listHref({}, { when: when === "upcoming" ? undefined : when })}
              className={buttonVariants({ variant: "ghost" })}
            >
              {t("clear")}
            </Link>
          ) : null}
        </div>
      </Form>
    </div>
  );
}
