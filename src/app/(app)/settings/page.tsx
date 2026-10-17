import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { type Formatters } from "@/i18n/format";
import { getFormat } from "@/i18n/get-format";
import { getBookingRulesFor } from "@/lib/booking-rules/service";
import { getPaymentTermsFor } from "@/lib/payment-terms/service";
import { DEFAULT_REQUEST_SETTINGS, getRequestSettingsFor } from "@/lib/booking-requests/settings";
import { getBankDetailsFor } from "@/lib/payments/bank";
import { outboxStatus } from "@/lib/email/outbox";
import { fromUtcDate } from "@/lib/calendar-date";
import { toDto as calendarDto } from "@/lib/google/calendar-settings";
import { calendarConnectAvailable, getConnectionStatus } from "@/lib/google/connection";
import { openDoubleBookings } from "@/lib/google/sync-issues";
import { exportUrl, toFeedDto } from "@/lib/ical/feeds";
import { legalComplete } from "@/lib/legal/legal";
import { getLegal } from "@/lib/legal/service";
import { privacyTemplate } from "@/lib/legal/template";
import { listProperties, type PropertyDto, toDto } from "@/lib/properties/service";
import { getCurrentUser } from "@/lib/session";

import {
  GoogleCalendarSection,
  type GoogleConnection,
  type PropertySync,
} from "./google-calendar-section";
import { BookingRulesSection } from "./booking-rules-section";
import { PaymentTermsSection } from "./payment-terms-section";
import { RequestSettingsSection } from "./request-settings-section";
import { BankDetailsSection } from "./bank-details-section";
import { EmailSection } from "./email-section";
import { GoLiveChecklist } from "./go-live-checklist";
import { LegalSection } from "./legal-section";
import { DoubleBookings } from "./double-bookings";
import { IcalSection } from "./ical-section";
import { PropertyArchiveButton } from "./property-archive-button";
import { PropertyFormDialog } from "./property-form-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.page");
  return { title: t("title") };
}

type Translate = Awaited<ReturnType<typeof getTranslations<"settings.page">>>;

function columnsFor(
  t: Translate,
  format: Formatters,
  editLabel: string,
  canList: boolean,
): Column<PropertyDto>[] {
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
            canList={canList}
            trigger={
              <Button variant="outline" size="sm" aria-label={t("editProperty", { name: p.name })}>
                {editLabel}
              </Button>
            }
          />
          <Link
            href={`/settings/properties/${p.id}/listing`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            aria-label={t("editListing", { name: p.name })}
          >
            {t("listing")}
          </Link>
          <PropertyArchiveButton property={p} />
        </div>
      ),
    },
  ];
}

function AddPropertyButton({ label, canList }: { label: string; canList: boolean }) {
  return (
    <PropertyFormDialog
      canList={canList}
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
  const [
    ical,
    doubleBookings,
    bookingRules,
    paymentTerms,
    requestSettings,
    bankDetails,
    legal,
    calendars,
  ] = await Promise.all([
    icalSettings(active.map((p) => p.id)),
    openDoubleBookings(),
    getBookingRulesFor(active.map((p) => p.id)),
    getPaymentTermsFor(active.map((p) => p.id)),
    getRequestSettingsFor(active.map((p) => p.id)),
    getBankDetailsFor(active.map((p) => p.id)),
    getLegal(),
    db.propertyCalendar.count({ where: { outbound: true } }),
  ]);
  const canList = legalComplete(legal);
  // The template states the longest retention of any property.
  const templateFacts = {
    imprint: legal,
    retentionMonths: Math.max(
      ...[...requestSettings.values()].map((s) => s.retentionMonths),
      ...(requestSettings.size === 0 ? [DEFAULT_REQUEST_SETTINGS.retentionMonths] : []),
    ),
    googleCalendar: calendars > 0,
  };
  const email = await outboxStatus();
  const t = await getTranslations("settings.page");
  const tCommon = await getTranslations("common");
  const columns = columnsFor(t, await getFormat(), tCommon("edit"), canList);
  const addProperty = <AddPropertyButton label={t("addProperty")} canList={canList} />;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={addProperty} />
      <div className="space-y-6">
        <GoLiveChecklist
          legal={legal}
          withoutBankDetails={active.filter((p) => !bankDetails.get(p.id)).map((p) => p.name)}
        />

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

        {doubleBookings.length > 0 ? (
          <DoubleBookings
            issues={doubleBookings.map((issue) => ({
              id: issue.id,
              feed: issue.feed?.name ?? "",
              property: issue.property.name,
              start: fromUtcDate(issue.startDate),
              end: fromUtcDate(issue.endDate),
              bookingIds: issue.bookingIds,
            }))}
          />
        ) : null}

        {active.length > 0 ? (
          <BookingRulesSection
            properties={active.map((p) => ({
              property: { id: p.id, name: p.name },
              rules: bookingRules.get(p.id)!,
            }))}
          />
        ) : null}

        {active.length > 0 ? (
          <PaymentTermsSection
            properties={active.map((p) => ({
              property: { id: p.id, name: p.name, currency: p.currency },
              terms: paymentTerms.get(p.id)!,
            }))}
          />
        ) : null}

        <LegalSection
          legal={legal}
          templates={{
            de: privacyTemplate("de-DE", templateFacts),
            en: privacyTemplate("en-GB", templateFacts),
          }}
        />

        <EmailSection status={email} />

        {active.length > 0 ? (
          <BankDetailsSection
            properties={active.map((p) => ({
              property: { id: p.id, name: p.name },
              details: bankDetails.get(p.id) ?? null,
            }))}
          />
        ) : null}

        {active.length > 0 ? (
          <RequestSettingsSection
            properties={active.map((p) => ({
              property: { id: p.id, name: p.name },
              settings: requestSettings.get(p.id)!,
            }))}
          />
        ) : null}

        {active.length > 0 ? (
          <IcalSection
            properties={active.map((p) => ({
              id: p.id,
              name: p.name,
              feeds: ical.feeds.get(p.id) ?? [],
              exportUrl: ical.exports.get(p.id) ?? null,
            }))}
          />
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

/** The booking platform feeds and export links of the active properties (GitLab #99). */
async function icalSettings(propertyIds: string[]) {
  const [feeds, tokens] = await Promise.all([
    db.icalFeed.findMany({
      where: { propertyId: { in: propertyIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.property.findMany({
      where: { id: { in: propertyIds }, icalExportToken: { not: null } },
      select: { id: true, icalExportToken: true },
    }),
  ]);
  const byProperty = new Map<string, ReturnType<typeof toFeedDto>[]>();
  for (const feed of feeds) {
    byProperty.set(feed.propertyId, [...(byProperty.get(feed.propertyId) ?? []), toFeedDto(feed)]);
  }
  return {
    feeds: byProperty,
    exports: new Map(tokens.map((p) => [p.id, exportUrl(p.icalExportToken!)])),
  };
}
