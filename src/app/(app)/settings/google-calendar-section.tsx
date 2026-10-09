"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFormat } from "@/i18n/use-format";

import { SyncFailures } from "./sync-failures";

export type GoogleConnection = {
  status: "not_connected" | "connected" | "disconnected";
  googleEmail?: string | null;
  connectedAt?: string | null;
  reason?: "revoked" | "key_changed" | null;
  /**
   * What the sync has done, over every booking, once the API reports it.
   * `lastError` is display text the server keeps free of guest data.
   */
  sync?: SyncSummary | null;
};

export type SyncSummary = {
  lastSyncedAt: string | null;
  pending: number;
  failed: number;
  lastError: string | null;
  /** Of `failed`: given up on, waiting for a manual retry. */
  dead?: number;
  /** Failing for over an hour: the app shows a banner. */
  alert?: boolean;
};

export type PropertySync = {
  property: { id: string; name: string };
  calendar: {
    calendarId: string;
    calendarName: string | null;
    outbound: boolean;
    inbound: boolean;
  } | null;
};

type GoogleCalendar = { id: string; summary: string; primary: boolean };

/** How Google sent the user back from the consent screen (`?google=`). */
const RETURNS = ["connected", "denied", "scope_missing", "unavailable", "error"] as const;
const REASONS = ["revoked", "key_changed"] as const;

function isOneOf<T extends string>(
  list: readonly T[],
  value: string | null | undefined,
): value is T {
  return list.includes(value as T);
}

async function send(url: string, unexpected: (status: number) => string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? unexpected(response.status));
    Object.assign(error, { fields: body?.error?.fields });
    throw error;
  }
  return body;
}

/**
 * Settings for the Google Calendar sync: connect the Google account, then
 * choose per property which writable calendar its bookings go to, and
 * whether events there come back as blocks. Rendered only when the server
 * can connect at all.
 */
export function GoogleCalendarSection({
  connection,
  properties,
  returned,
}: {
  connection: GoogleConnection;
  properties: PropertySync[];
  /** The `?google=` result of a round trip through Google's consent screen. */
  returned?: string;
}) {
  const router = useRouter();
  const t = useTranslations("settings.google");
  const tCommon = useTranslations("common");
  const format = useFormat();
  const unexpected = (status: number) => tCommon("serverAnswered", { status });
  const notice = isOneOf(RETURNS, returned)
    ? { ok: returned === "connected", message: t(`returns.${returned}`) }
    : undefined;
  const connected = connection.status === "connected";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <p
            role={notice.ok ? "status" : "alert"}
            className={notice.ok ? "text-sm" : "text-destructive text-sm"}
          >
            {notice.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {connected ? (
              <>
                <p className="font-medium">
                  {t("connectedAs", { email: connection.googleEmail ?? "" })}
                </p>
                {connection.connectedAt ? (
                  <p className="text-muted-foreground">
                    {t("since", { time: format.dateTime(connection.connectedAt, "UTC") })}
                  </p>
                ) : null}
                {connection.sync ? <SyncStatus sync={connection.sync} /> : null}
              </>
            ) : connection.status === "disconnected" ? (
              <>
                <p className="text-destructive font-medium">{t("disconnected")}</p>
                <p className="text-muted-foreground">
                  {isOneOf(REASONS, connection.reason)
                    ? t(`reasons.${connection.reason}`)
                    : t("reasons.unknown")}{" "}
                  {t("reconnectHint")}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("notConnected")}</p>
            )}
          </div>
          {connected ? (
            <ConfirmDialog
              trigger={<Button variant="outline">{t("disconnect")}</Button>}
              title={t("disconnectTitle")}
              description={t("disconnectDescription")}
              confirmLabel={t("disconnect")}
              cancelLabel={t("stayConnected")}
              destructive
              onConfirm={async () => {
                await send("/api/google/connection", unexpected, { method: "DELETE" });
                toastSuccess(t("disconnected_toast"));
                router.refresh();
              }}
            />
          ) : (
            // A plain link: the server redirects to Google's consent screen.
            <a href="/api/google/connect" className={buttonVariants()}>
              {connection.status === "disconnected" ? t("reconnect") : t("connect")}
            </a>
          )}
        </div>

        {connected ? <PropertyCalendars properties={properties} /> : null}
        {connected ? (
          <section
            id="google-sync"
            aria-labelledby="google-sync-title"
            className="space-y-2 border-t pt-4"
          >
            <h3 id="google-sync-title" className="text-sm font-medium">
              {t("syncProblems")}
            </h3>
            <SyncFailures />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Last sync, what is waiting, and what failed, over every property. */
function SyncStatus({ sync }: { sync: SyncSummary }) {
  const t = useTranslations("settings.google");
  const format = useFormat();
  return (
    <p className="text-muted-foreground">
      {sync.lastSyncedAt
        ? t("lastSynced", { time: format.dateTime(sync.lastSyncedAt, "UTC") })
        : t("nothingSynced")}
      {sync.pending > 0 ? t("waiting", { count: sync.pending }) : ""}
      {sync.failed > 0 ? (
        <span className="text-destructive">
          {" "}
          {t("failed", { count: sync.failed })}
          {sync.dead ? t("stopped", { count: sync.dead }) : ""}
          {sync.lastError ? `: ${sync.lastError}` : ""}
        </span>
      ) : null}
    </p>
  );
}

/** The per-property settings, with the account's writable calendars to choose from. */
function PropertyCalendars({ properties }: { properties: PropertySync[] }) {
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const t = useTranslations("settings.google");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/google/calendars", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? t("unreachable"));
        setCalendars(body as GoogleCalendar[]);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(error instanceof Error ? error.message : t("unreachable"));
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; t only words the failure
  }, []);

  if (properties.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("addProperty")}</p>;
  }
  return (
    <div className="divide-y border-t">
      {failure ? (
        <p role="alert" className="text-destructive py-3 text-sm">
          {t("calendarsFailed", { reason: failure })}
        </p>
      ) : null}
      {properties.map((entry) => (
        <PropertyCalendarRow key={entry.property.id} entry={entry} calendars={calendars} />
      ))}
    </div>
  );
}

function PropertyCalendarRow({
  entry,
  calendars,
}: {
  entry: PropertySync;
  /** Null while loading. */
  calendars: GoogleCalendar[] | null;
}) {
  const router = useRouter();
  const t = useTranslations("settings.google");
  const tCommon = useTranslations("common");
  const unexpected = (status: number) => tCommon("serverAnswered", { status });
  const { property, calendar } = entry;
  const [values, setValues] = useState({
    calendarId: calendar?.calendarId ?? "",
    outbound: calendar?.outbound ?? true,
    inbound: calendar?.inbound ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const prefix = `gcal-${property.id}`;
  const changed =
    values.calendarId !== (calendar?.calendarId ?? "") ||
    values.outbound !== (calendar?.outbound ?? true) ||
    values.inbound !== (calendar?.inbound ?? false);
  // The chosen calendar stays listed even before the list arrives, or if it
  // is no longer writable.
  const options = [
    ...(calendar && !calendars?.some((c) => c.id === calendar.calendarId)
      ? [
          {
            id: calendar.calendarId,
            summary: calendar.calendarName ?? calendar.calendarId,
            primary: false,
          },
        ]
      : []),
    ...(calendars ?? []),
  ];

  async function save() {
    setPending(true);
    setError(null);
    try {
      await send(`/api/properties/${property.id}/calendar`, unexpected, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      toastSuccess(t("willSync", { name: property.name }), t("willSyncHint"));
      router.refresh();
    } catch (failure) {
      const fields = (failure as { fields?: Record<string, string[]> }).fields;
      setError(
        fields?.calendarId
          ? t("calendarField", { message: fields.calendarId.join(", ") })
          : (failure as Error).message,
      );
    } finally {
      setPending(false);
    }
  }

  async function resync() {
    try {
      const { scheduled } = (await send(
        `/api/properties/${property.id}/calendar/resync`,
        unexpected,
        {
          method: "POST",
        },
      )) as { scheduled: number };
      toastSuccess(t("resyncStarted"), t("queued", { count: scheduled }));
      router.refresh();
    } catch (failure) {
      toastError(failure, t("resyncFailed"));
    }
  }

  return (
    <div className="grid gap-3 py-4 md:grid-cols-[12rem_1fr] md:items-start">
      <div>
        <p className="font-medium">{property.name}</p>
        {calendar ? (
          <p className="text-muted-foreground text-sm">
            {calendar.outbound ? t("syncing") : t("notSending")}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t("notSynced")}</p>
        )}
      </div>
      <div className="grid gap-3">
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-calendar`}>{t("calendar")}</FieldLabel>
          <NativeSelect
            id={`${prefix}-calendar`}
            className="w-full"
            value={values.calendarId}
            aria-invalid={error ? true : undefined}
            disabled={calendars === null && !calendar}
            onChange={(event) => setValues((v) => ({ ...v, calendarId: event.target.value }))}
          >
            <NativeSelectOption value="" disabled>
              {calendars === null ? t("loadingCalendars") : t("chooseCalendar")}
            </NativeSelectOption>
            {options.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? t("main") : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${prefix}-outbound`}
              checked={values.outbound}
              onCheckedChange={(checked) => setValues((v) => ({ ...v, outbound: checked }))}
            />
            <FieldLabel htmlFor={`${prefix}-outbound`}>{t("outbound")}</FieldLabel>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${prefix}-inbound`}
              checked={values.inbound}
              onCheckedChange={(checked) => setValues((v) => ({ ...v, inbound: checked }))}
            />
            <FieldLabel htmlFor={`${prefix}-inbound`}>{t("inbound")}</FieldLabel>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !values.calendarId || !changed}
            aria-busy={pending}
            onClick={save}
          >
            {pending ? tCommon("saving") : calendar ? tCommon("save") : t("startSyncing")}
          </Button>
          {calendar?.outbound ? (
            <Button size="sm" variant="outline" onClick={resync}>
              {t("resync")}
            </Button>
          ) : null}
          {calendar ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  {t("stopSyncing")}
                </Button>
              }
              title={t("stopTitle", { name: property.name })}
              description={t("stopDescription")}
              confirmLabel={t("stopSyncing")}
              cancelLabel={t("keepSyncing")}
              onConfirm={async () => {
                await send(`/api/properties/${property.id}/calendar`, unexpected, {
                  method: "DELETE",
                });
                toastSuccess(t("stoppedToast", { name: property.name }));
                router.refresh();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
