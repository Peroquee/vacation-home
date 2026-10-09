"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { dashboardHref, type DashboardState, PRESETS, type Preset } from "@/lib/dashboard/params";
import { cn } from "@/lib/utils";

/**
 * The one filter state every dashboard widget follows: a date range (a
 * preset or custom dates) and a property, kept in the URL. A change
 * navigates within a transition, so the widgets keep showing the current
 * figures, dimmed, until all the new ones are ready, and then update
 * together: no page reload, no widget ahead of the others.
 */
export function DashboardFilters({
  state,
  properties,
  children,
}: {
  state: Omit<DashboardState, "compare">;
  properties: { id: string; name: string }[];
  /** The widgets, dimmed while new figures load. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("dashboard.filters");
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(state.preset === "custom");
  const [dates, setDates] = useState({ from: state.from, until: state.until });

  function go(next: Partial<Omit<DashboardState, "compare">>) {
    startTransition(() => router.push(dashboardHref({ ...state, ...next }), { scroll: false }));
  }

  const choice: Preset | "custom" = custom ? "custom" : state.preset;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label={t("period")} className="flex flex-wrap gap-1">
          {[...PRESETS, "custom" as const].map((preset) => (
            <Button
              key={preset}
              type="button"
              role="radio"
              size="sm"
              aria-checked={choice === preset}
              variant={choice === preset ? "secondary" : "ghost"}
              onClick={() => {
                if (preset === "custom") return setCustom(true);
                setCustom(false);
                go({ preset });
              }}
            >
              {t(`presets.${preset}`)}
            </Button>
          ))}
        </div>

        {custom ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (dates.from && dates.until && dates.from <= dates.until) {
                go({ preset: "custom", ...dates });
              }
            }}
          >
            <Field className="w-auto">
              <FieldLabel htmlFor="dashboard-from">{t("from")}</FieldLabel>
              <Input
                id="dashboard-from"
                type="date"
                value={dates.from}
                max={dates.until}
                onChange={(event) => setDates((d) => ({ ...d, from: event.target.value }))}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="dashboard-until">{t("until")}</FieldLabel>
              <Input
                id="dashboard-until"
                type="date"
                value={dates.until}
                min={dates.from}
                onChange={(event) => setDates((d) => ({ ...d, until: event.target.value }))}
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              disabled={!dates.from || !dates.until || dates.from > dates.until}
            >
              {t("show")}
            </Button>
          </form>
        ) : null}

        <Field className="w-auto sm:ml-auto">
          <FieldLabel htmlFor="dashboard-property">{t("property")}</FieldLabel>
          <NativeSelect
            id="dashboard-property"
            value={state.propertyId ?? ""}
            onChange={(event) => go({ propertyId: event.target.value || undefined })}
          >
            <NativeSelectOption value="">{t("allProperties")}</NativeSelectOption>
            {properties.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div aria-busy={pending} className={cn("transition-opacity", pending && "opacity-60")}>
        {children}
      </div>
    </>
  );
}
