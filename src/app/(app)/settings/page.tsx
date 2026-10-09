import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { type Formatters } from "@/i18n/format";
import { getFormat } from "@/i18n/get-format";
import { toDto as calendarDto } from "@/lib/google/calendar-settings";
import { calendarConnectAvailable, getConnectionStatus } from "@/lib/google/connection";
import { listProperties, type PropertyDto, toDto } from "@/lib/properties/service";
import { getCurrentUser } from "@/lib/session";

import {
  GoogleCalendarSection,
  type GoogleConnection,
  type PropertySync,
} from "./google-calendar-section";
import { PropertyArchiveButton } from "./property-archive-button";
import { PropertyFormDialog } from "./property-form-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.page");
  return { title: t("title") };
}

type Translate = Awaited<ReturnType<typeof getTranslations<"settings.page">>>;

function columnsFor(t: Translate, format: Formatters, editLabel: string): Column<PropertyDto>[] {
  return [
    {
      id: "name",
      header: t("columns.property"),
      cell: (p) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="font-medium">{p.name}</span>
        </div>
      ),
    },
    { id: "timezone", header: t("columns.timezone"), cell: (p) => p.timezone },
    {
      id: "rate",
      header: t("columns.rate"),
      cell: (p) => format.money(p.defaultNightlyRateMinor, p.currency),
      align: "end",
    },
    {
      id: "cleaning",
      header: t("columns.cleaning"),
      cell: (p) => format.money(p.defaultCleaningFeeMinor, p.currency),
      align: "end",
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (p) => (
        <div className="flex justify-end gap-2">
          <PropertyFormDialog
            property={p}
            trigger={
              <Button variant="outline" size="sm" aria-label={t("editProperty", { name: p.name })}>
                {editLabel}
              </Button>
            }
          />
          <PropertyArchiveButton property={p} />
        </div>
      ),
    },
  ];
}

function AddPropertyButton({ label }: { label: string }) {
  return (
    <PropertyFormDialog
      trigger={
        <Button>
          <Plus data-icon="inline-start" aria-hidden />
          {label}
        </Button>
      }
    />
  );
}

/** `?google=` reports how a round trip through Google's consent screen ended. */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const returned = (await searchParams).google;
  // Read at request time: the list changes with every edit.
  await connection();
  const properties = (await listProperties({ includeArchived: true })).map(toDto);
  const active = properties.filter((p) => !p.archived);
  const archived = properties.filter((p) => p.archived);
  const google = await googleSettings(active.map((p) => ({ id: p.id, name: p.name })));
  const t = await getTranslations("settings.page");
  const tCommon = await getTranslations("common");
  const columns = columnsFor(t, await getFormat(), tCommon("edit"));
  const addProperty = <AddPropertyButton label={t("addProperty")} />;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={addProperty} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("properties")}</CardTitle>
            <CardDescription>{t("propertiesHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption={t("properties")}
              columns={columns}
              rows={active}
              rowKey={(p) => p.id}
              empty={
                <EmptyState
                  icon={Building2}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  action={addProperty}
                />
              }
            />
          </CardContent>
        </Card>

        {archived.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("archivedTitle")}</CardTitle>
              <CardDescription>{t("archivedHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                caption={t("archivedCaption")}
                columns={columns}
                rows={archived}
                rowKey={(p) => p.id}
                empty={null}
              />
            </CardContent>
          </Card>
        ) : null}

        {google ? (
          <GoogleCalendarSection
            connection={google.connection}
            properties={google.properties}
            returned={typeof returned === "string" ? returned : undefined}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The Google Calendar section's data, or null when this server cannot
 * connect to Google at all (no encryption key), so the section stays hidden.
 */
async function googleSettings(
  properties: { id: string; name: string }[],
): Promise<{ connection: GoogleConnection; properties: PropertySync[] } | null> {
  if (!calendarConnectAvailable()) return null;
  const user = await getCurrentUser();
  const [status, configs] = await Promise.all([
    user ? getConnectionStatus(user.id) : { status: "not_connected" as const },
    db.propertyCalendar.findMany({ where: { propertyId: { in: properties.map((p) => p.id) } } }),
  ]);
  const byProperty = new Map(configs.map((c) => [c.propertyId, calendarDto(c)]));
  return {
    connection: {
      ...status,
      connectedAt: "connectedAt" in status ? (status.connectedAt?.toISOString() ?? null) : null,
    },
    properties: properties.map((property) => ({
      property,
      calendar: byProperty.get(property.id) ?? null,
    })),
  };
}
