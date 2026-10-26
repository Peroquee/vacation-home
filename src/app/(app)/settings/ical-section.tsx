"use client";

import { Hint } from "@/components/help/hint";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import type { FeedDto } from "@/lib/ical/feeds";

type FieldErrors = Record<string, string[] | undefined>;

export type IcalProperty = {
  id: string;
  name: string;
  feeds: FeedDto[];
  /** The export feed's URL, or null while it is off. */
  exportUrl: string | null;
};

/** Names offered when adding a feed; any other name works too. */
const PLATFORMS = ["Airbnb", "Booking.com", "Vrbo", "FeWo-direkt", "Holidu"];

/** A failed request, with the API's field messages for a 422. */
class RequestError extends Error {
  constructor(
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }
}

/**
 * Booking platforms' calendars, per property (GitLab #99): their iCal feeds
 * in (stays become read-only blocks), and the property's own availability
 * out, for the platforms to import.
 */
export function IcalSection({ properties }: { properties: IcalProperty[] }) {
  const t = useTranslations("settings.ical");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {properties.map((property) => (
          <PropertyFeeds key={property.id} property={property} />
        ))}
      </CardContent>
    </Card>
  );
}

function useRequest() {
  const api = useApiText();
  const tCommon = useTranslations("common");
  return async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new RequestError(
        api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        body?.error?.fields ? api.fields(body.error.fields) : undefined,
      );
    }
    return body;
  };
}

function PropertyFeeds({ property }: { property: IcalProperty }) {
  const t = useTranslations("settings.ical");
  return (
    <section
      aria-labelledby={`ical-${property.id}`}
      className="space-y-4 py-4 first:pt-0 last:pb-0"
    >
      <h3 id={`ical-${property.id}`} className="font-medium">
        {property.name}
      </h3>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("importTitle")}</h4>
        {property.feeds.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noFeeds")}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {property.feeds.map((feed) => (
              <FeedRow key={feed.id} feed={feed} />
            ))}
          </ul>
        )}
        <AddFeed propertyId={property.id} />
      </div>
      <ExportFeed propertyId={property.id} url={property.exportUrl} />
    </section>
  );
}

/** What the last fetch said, in words. */
function useFeedStatus() {
  const t = useTranslations("settings.ical");
  const format = useFormat();
  return (feed: FeedDto): { text: string; failed: boolean } => {
    if (feed.lastError) {
      const status = /^http_(\d+)$/.exec(feed.lastError)?.[1];
      const reason = status
        ? t("errors.http", { status })
        : (["unreachable", "timeout", "too_large", "not_ical"] as const).includes(
              feed.lastError as "unreachable",
            )
          ? t(`errors.${feed.lastError as "unreachable" | "timeout" | "too_large" | "not_ical"}`)
          : t("errors.other");
      return { text: reason, failed: true };
    }
    if (!feed.lastSuccessAt) return { text: t("notFetched"), failed: false };
    return {
      text: t("fetched", {
        count: feed.eventCount,
        time: format.dateTime(feed.lastSuccessAt, "UTC"),
      }),
      failed: false,
    };
  };
}

function FeedRow({ feed }: { feed: FeedDto }) {
  const t = useTranslations("settings.ical");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const request = useRequest();
  const status = useFeedStatus()(feed);
  const format = useFormat();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await request(`/api/ical-feeds/${feed.id}/refresh`, { method: "POST" });
      router.refresh();
    } catch (error) {
      toastError(error, t("refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          {feed.name} <span className="text-muted-foreground font-normal">· {feed.host}</span>
        </p>
        <p className={status.failed ? "text-destructive" : "text-muted-foreground"}>
          {status.text}
        </p>
        {feed.conflictCount > 0 ? (
          <p className="text-destructive font-medium">
            {t("conflicts", { count: feed.conflictCount })}
          </p>
        ) : null}
        {feed.heldCount > 0 && feed.heldSince ? (
          <p className="text-destructive font-medium">
            {t("held", {
              count: feed.heldCount,
              time: format.dateTime(feed.heldSince, "UTC"),
            })}
          </p>
        ) : null}
        {feed.droppedEventCount > 0 ? (
          <p className="text-destructive">{t("dropped", { count: feed.droppedEventCount })}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={refresh}
        >
          <RefreshCw data-icon="inline-start" aria-hidden />
          {refreshing ? t("refreshing") : t("refresh")}
        </Button>
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost">
              {tCommon("delete")}
            </Button>
          }
          title={t("removeTitle", { name: feed.name })}
          description={t("removeDescription")}
          confirmLabel={t("remove")}
          destructive
          onConfirm={async () => {
            await request(`/api/ical-feeds/${feed.id}`, { method: "DELETE" });
            toastSuccess(t("removed", { name: feed.name }));
            router.refresh();
          }}
        />
      </div>
    </li>
  );
}

function AddFeed({ propertyId }: { propertyId: string }) {
  const t = useTranslations("settings.ical");
  const tForms = useTranslations("forms");
  const router = useRouter();
  const request = useRequest();
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ name: "", url: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("add")}
      </Button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const feed = (await request(`/api/properties/${propertyId}/ical-feeds`, {
        method: "POST",
        body: JSON.stringify(values),
      })) as FeedDto;
      toastSuccess(
        t("added", { name: feed.name }),
        feed.lastError ? t("addedButFailed") : t("addedCount", { count: feed.eventCount }),
      );
      setValues({ name: "", url: "" });
      setOpen(false);
      router.refresh();
    } catch (error) {
      if (error instanceof RequestError && error.fields) setErrors(error.fields);
      else toastError(error, t("addFailed"));
    } finally {
      setPending(false);
    }
  }

  const fields = [
    { key: "name", label: t("name"), hint: undefined, list: `${prefix}-platforms` },
    { key: "url", label: t("url"), hint: t("urlHint"), list: undefined },
  ] as const;

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-lg border p-3">
      <datalist id={`${prefix}-platforms`}>
        {PLATFORMS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {fields.map(({ key, label, hint, list }) => {
        const messages = errors[key];
        return (
          <Field key={key} data-invalid={messages ? true : undefined}>
            <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
            <Input
              id={`${prefix}-${key}`}
              list={list}
              type={key === "url" ? "url" : "text"}
              autoComplete="off"
              aria-invalid={messages ? true : undefined}
              value={values[key]}
              onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
            />
            {hint ? <FieldDescription>{hint}</FieldDescription> : null}
            <FieldError
              errors={messages?.map((message) => ({
                message: tForms("fieldError", { label, message }),
              }))}
            />
          </Field>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? t("adding") : t("addSubmit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function ExportFeed({ propertyId, url }: { propertyId: string; url: string | null }) {
  const t = useTranslations("settings.ical");
  const router = useRouter();
  const request = useRequest();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const endpoint = `/api/properties/${propertyId}/ical-export`;

  async function toggle(on: boolean) {
    setPending(true);
    try {
      await request(endpoint, on ? { method: "POST", body: "{}" } : { method: "DELETE" });
      router.refresh();
    } catch (error) {
      toastError(error, t("exportFailed"));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError(null, t("copyFailed"));
    }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{t("exportTitle")}</h4>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id={`${id}-export`}
          checked={url !== null}
          disabled={pending}
          onCheckedChange={(checked) => toggle(checked)}
        />
        <FieldLabel htmlFor={`${id}-export`}>{t("exportEnable")}</FieldLabel>
      </Field>
      <p className="text-muted-foreground text-sm">
        {t("exportHint")}
        <Hint label={t("hintLabels.exportUrl")}>{t("hintTexts.exportUrl")}</Hint>
      </p>
      {url ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label={t("exportUrl")}
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? (
                <Check data-icon="inline-start" aria-hidden />
              ) : (
                <Copy data-icon="inline-start" aria-hidden />
              )}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("exportReach")}</p>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" disabled={pending}>
                {t("rotate")}
              </Button>
            }
            title={t("rotateTitle")}
            description={t("rotateDescription")}
            confirmLabel={t("rotateConfirm")}
            destructive
            onConfirm={async () => {
              await request(endpoint, { method: "POST", body: JSON.stringify({ rotate: true }) });
              toastSuccess(t("rotated"));
              router.refresh();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
