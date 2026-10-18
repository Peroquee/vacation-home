"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";
import type { StayDiscount } from "@/lib/pricing/engine";

/**
 * A property's length-of-stay discounts (GitLab #119), on its pricing page:
 * "from 7 nights 10% off". The highest tier a stay reaches comes off its
 * nights - not the cleaning fee. Guests see the tiers next to the price.
 */
export function DiscountsCard({
  propertyId,
  tiers,
}: {
  propertyId: string;
  tiers: StayDiscount[];
}) {
  const t = useTranslations("settings.discounts");
  const tPricing = useTranslations("pricing");
  return (
    <Card id="discounts">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-2">
        {tiers.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {tiers.map((tier) => (
              <li key={tier.minNights}>
                {tPricing("discountHint", { nights: tier.minNights, percent: tier.percent })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        )}
        <DiscountsDialog propertyId={propertyId} tiers={tiers} />
      </CardContent>
    </Card>
  );
}

type Row = { key: number; minNights: string; percent: string };

function DiscountsDialog({ propertyId, tiers }: { propertyId: string; tiers: StayDiscount[] }) {
  const t = useTranslations("settings.discounts");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const initial = (): Row[] =>
    tiers.map((tier, i) => ({
      key: i,
      minNights: String(tier.minNights),
      percent: String(tier.percent),
    }));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const change = (key: number, field: "minNights" | "percent", value: string) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : text);
    setPending(true);
    try {
      const response = await fetch(`/api/properties/${propertyId}/stay-discounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiers: rows.map((row) => ({
            minNights: whole(row.minNights),
            percent: whole(row.percent),
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const fields = body?.error?.fields as Record<string, string[]> | undefined;
        if (response.status === 422 && fields) {
          setErrors(Object.values(api.fields(fields)).flatMap((messages) => messages ?? []));
          return;
        }
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(t("saved"));
      setOpen(false);
      router.refresh();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setRows(initial());
          setErrors([]);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("edit")}
          </Button>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form id={`discounts-${propertyId}`} onSubmit={submit} noValidate className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("none")}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row, i) => (
                <li key={row.key} className="flex items-center gap-2 text-sm">
                  <span>{t("from")}</span>
                  <Input
                    aria-label={t("nightsOf", { n: i + 1 })}
                    inputMode="numeric"
                    className="w-20"
                    value={row.minNights}
                    onChange={(event) => change(row.key, "minNights", event.target.value)}
                  />
                  <span>{t("nights")}</span>
                  <Input
                    aria-label={t("percentOf", { n: i + 1 })}
                    inputMode="numeric"
                    className="w-20"
                    value={row.percent}
                    onChange={(event) => change(row.key, "percent", event.target.value)}
                  />
                  <span>{t("percentOff")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("remove", { n: i + 1 })}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {rows.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    key: Math.max(-1, ...current.map((r) => r.key)) + 1,
                    minNights: "",
                    percent: "",
                  },
                ])
              }
            >
              <Plus data-icon="inline-start" aria-hidden />
              {t("add")}
            </Button>
          ) : null}
          <FieldError errors={errors.map((message) => ({ message }))} />
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            form={`discounts-${propertyId}`}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
