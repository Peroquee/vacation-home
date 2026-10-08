"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";

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
const RETURNS: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "Google Calendar is connected." },
  denied: { ok: false, message: "Google Calendar was not connected: access was declined." },
  scope_missing: {
    ok: false,
    message:
      "Google Calendar was not connected: the calendar permission was not granted. Connect again and allow access to your calendars.",
  },
  unavailable: { ok: false, message: "Connecting Google Calendar is switched off on this server." },
  error: { ok: false, message: "Google Calendar could not be connected. Please try again." },
};

const DISCONNECTED: Record<string, string> = {
  revoked:
    "Google no longer allows this app to use your calendar, for example because access was removed in your Google account.",
  key_changed:
    "The server's encryption key changed, so the stored Google access can no longer be read.",
};

async function send(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `The server answered ${response.status}.`);
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
  const notice = returned ? RETURNS[returned] : undefined;
  const connected = connection.status === "connected";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Calendar</CardTitle>
        <CardDescription>
          Bookings appear in the Google calendar you choose for each property, and events there can
          block dates here.
        </CardDescription>
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
                <p className="font-medium">Connected as {connection.googleEmail}</p>
                {connection.connectedAt ? (
                  <p className="text-muted-foreground">
                    Since {formatDateTime(connection.connectedAt, "UTC")} (UTC)
                  </p>
                ) : null}
                {connection.sync ? <SyncStatus sync={connection.sync} /> : null}
              </>
            ) : connection.status === "disconnected" ? (
              <>
                <p className="text-destructive font-medium">Disconnected</p>
                <p className="text-muted-foreground">
                  {DISCONNECTED[connection.reason ?? ""] ?? "Google access has stopped working."}{" "}
                  Reconnect to resume syncing.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Not connected.</p>
            )}
          </div>
          {connected ? (
            <ConfirmDialog
              trigger={<Button variant="outline">Disconnect</Button>}
              title="Disconnect Google Calendar?"
              description="All syncing stops, for every property. Events already in your Google calendars are left untouched; delete them there if you no longer want them."
              confirmLabel="Disconnect"
              cancelLabel="Stay connected"
              destructive
              onConfirm={async () => {
                await send("/api/google/connection", { method: "DELETE" });
                toastSuccess("Google Calendar disconnected");
                router.refresh();
              }}
            />
          ) : (
            // A plain link: the server redirects to Google's consent screen.
            <a href="/api/google/connect" className={buttonVariants()}>
              {connection.status === "disconnected" ? "Reconnect" : "Connect Google Calendar"}
            </a>
          )}
        </div>

        {connected ? <PropertyCalendars properties={properties} /> : null}
      </CardContent>
    </Card>
  );
}

/** Last sync, what is waiting, and what failed, over every property. */
function SyncStatus({ sync }: { sync: SyncSummary }) {
  return (
    <p className="text-muted-foreground">
      {sync.lastSyncedAt
        ? `Last synced ${formatDateTime(sync.lastSyncedAt, "UTC")} (UTC)`
        : "Nothing synced yet"}
      {sync.pending > 0 ? ` · ${sync.pending} waiting` : ""}
      {sync.failed > 0 ? (
        <span className="text-destructive">
          {" "}
          · {sync.failed} failed{sync.lastError ? `: ${sync.lastError}` : ""}
        </span>
      ) : null}
    </p>
  );
}

/** The per-property settings, with the account's writable calendars to choose from. */
function PropertyCalendars({ properties }: { properties: PropertySync[] }) {
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/google/calendars", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? "Google could not be reached.");
        setCalendars(body as GoogleCalendar[]);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(error instanceof Error ? error.message : "Google could not be reached.");
        }
      });
    return () => controller.abort();
  }, []);

  if (properties.length === 0) {
    return <p className="text-muted-foreground text-sm">Add a property to choose its calendar.</p>;
  }
  return (
    <div className="divide-y border-t">
      {failure ? (
        <p role="alert" className="text-destructive py-3 text-sm">
          Your calendars could not be loaded: {failure}
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
      await send(`/api/properties/${property.id}/calendar`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      toastSuccess(`${property.name} will sync`, "Its bookings are being sent to the calendar.");
      router.refresh();
    } catch (failure) {
      const fields = (failure as { fields?: Record<string, string[]> }).fields;
      setError(
        fields?.calendarId
          ? `Calendar ${fields.calendarId.join(", ")}`
          : (failure as Error).message,
      );
    } finally {
      setPending(false);
    }
  }

  async function resync() {
    try {
      const { scheduled } = (await send(`/api/properties/${property.id}/calendar/resync`, {
        method: "POST",
      })) as { scheduled: number };
      toastSuccess(
        "Resync started",
        `${scheduled} ${scheduled === 1 ? "booking" : "bookings"} queued.`,
      );
      router.refresh();
    } catch (failure) {
      toastError(failure, "Could not resync");
    }
  }

  return (
    <div className="grid gap-3 py-4 md:grid-cols-[12rem_1fr] md:items-start">
      <div>
        <p className="font-medium">{property.name}</p>
        {calendar ? (
          <p className="text-muted-foreground text-sm">
            {calendar.outbound ? "Syncing" : "Not sending bookings"}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Not synced</p>
        )}
      </div>
      <div className="grid gap-3">
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}-calendar`}>Calendar</FieldLabel>
          <NativeSelect
            id={`${prefix}-calendar`}
            className="w-full"
            value={values.calendarId}
            aria-invalid={error ? true : undefined}
            disabled={calendars === null && !calendar}
            onChange={(event) => setValues((v) => ({ ...v, calendarId: event.target.value }))}
          >
            <NativeSelectOption value="" disabled>
              {calendars === null ? "Loading your calendars…" : "Choose a calendar"}
            </NativeSelectOption>
            {options.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (main)" : ""}
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
            <FieldLabel htmlFor={`${prefix}-outbound`}>Send bookings to Google</FieldLabel>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${prefix}-inbound`}
              checked={values.inbound}
              onCheckedChange={(checked) => setValues((v) => ({ ...v, inbound: checked }))}
            />
            <FieldLabel htmlFor={`${prefix}-inbound`}>
              Block dates for other events there
            </FieldLabel>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !values.calendarId || !changed}
            aria-busy={pending}
            onClick={save}
          >
            {pending ? "Saving…" : calendar ? "Save" : "Start syncing"}
          </Button>
          {calendar?.outbound ? (
            <Button size="sm" variant="outline" onClick={resync}>
              Resync everything
            </Button>
          ) : null}
          {calendar ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  Stop syncing
                </Button>
              }
              title={`Stop syncing ${property.name}?`}
              description="New and changed bookings are no longer sent to Google. Events already in the calendar are left untouched."
              confirmLabel="Stop syncing"
              cancelLabel="Keep syncing"
              onConfirm={async () => {
                await send(`/api/properties/${property.id}/calendar`, { method: "DELETE" });
                toastSuccess(`${property.name} no longer syncs`);
                router.refresh();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
