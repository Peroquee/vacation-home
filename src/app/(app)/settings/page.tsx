import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import { connection } from "next/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { listProperties, type PropertyDto, toDto } from "@/lib/properties/service";

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

export default async function SettingsPage() {
  // Read at request time: the list changes with every edit.
  await connection();
  const properties = (await listProperties({ includeArchived: true })).map(toDto);
  const active = properties.filter((p) => !p.archived);
  const archived = properties.filter((p) => p.archived);

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
      </div>
    </>
  );
}
