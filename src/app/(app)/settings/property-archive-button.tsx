"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { PropertyDto } from "@/lib/properties/service";
import { useApiText } from "@/i18n/use-api-text";

async function post(url: string, fail: (body: unknown, status: number) => string) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(fail(body, response.status));
  }
}

/**
 * Archives an active property after asking, or restores an archived one
 * straight away: restoring loses nothing, so it needs no confirmation.
 */
export function PropertyArchiveButton({ property }: { property: PropertyDto }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const t = useTranslations("settings.archive");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });

  if (property.archived) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          try {
            await post(`/api/properties/${property.id}/unarchive`, fail);
            toastSuccess(t("restored", { name: property.name }));
            router.refresh();
          } catch (error) {
            toastError(error, t("restoreFailed"));
          } finally {
            setPending(false);
          }
        }}
      >
        {t("restore")}
      </Button>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("archive")}
        </Button>
      }
      title={t("title", { name: property.name })}
      description={t("description")}
      confirmLabel={t("archive")}
      onConfirm={async () => {
        await post(`/api/properties/${property.id}/archive`, fail);
        toastSuccess(t("archived", { name: property.name }));
        router.refresh();
      }}
    />
  );
}
