import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import { connection } from "next/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { db } from "@/lib/db";
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

export const metadata: Metadata = { title: "Settings" };

const columns: Column<PropertyDto>[] = [
  {
    id: "name",
    header: "Property",
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
  { id: "timezone", header: "Timezone", cell: (p) => p.timezone },
  {
    id: "rate",
    header: "Nightly rate",
    cell: (p) => formatMoney(p.defaultNightlyRateMinor, p.currency),
    align: "end",
  },
  {
    id: "cleaning",
    header: "Cleaning fee",
    cell: (p) => formatMoney(p.defaultCleaningFeeMinor, p.currency),
    align: "end",
  },
  {
    id: "actions",
    header: <span className="sr-only">Actions</span>,
    cell: (p) => (
      <div className="flex justify-end gap-2">
        <PropertyFormDialog
          property={p}
          trigger={
            <Button variant="outline" size="sm" aria-label={`Edit ${p.name}`}>
              Edit
            </Button>
          }
        />
        <PropertyArchiveButton property={p} />
      </div>
    ),
  },
];

function AddPropertyButton() {
  return (
    <PropertyFormDialog
      trigger={
        <Button>
          <Plus data-icon="inline-start" aria-hidden />
          Add property
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

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your properties and the defaults every new booking starts from."
        actions={<AddPropertyButton />}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Properties</CardTitle>
            <CardDescription>
              Changing a default rate or fee affects new bookings only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Properties"
              columns={columns}
              rows={active}
              rowKey={(p) => p.id}
              empty={
                <EmptyState
                  icon={Building2}
                  title="No properties yet"
                  description="Add the place you rent out to start taking bookings."
                  action={<AddPropertyButton />}
                />
              }
            />
          </CardContent>
        </Card>

        {archived.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Archived</CardTitle>
              <CardDescription>
                Hidden from property selectors. Their bookings and finances stay visible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                caption="Archived properties"
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
