"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useApiText } from "@/i18n/use-api-text";

/**
 * Erases a guest's personal data (DSGVO Art. 17) after an explicit
 * confirmation. The API wants the guest's id repeated as that confirmation.
 * A guest with bookings is anonymised and stays, so the page refreshes; one
 * without is deleted, so the page leaves for the booking list.
 */
export function EraseGuestButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const t = useTranslations("guests");
  const tCommon = useTranslations("common");
  const api = useApiText();

  return (
    <ConfirmDialog
      trigger={<Button variant="destructive">{t("erase.trigger")}</Button>}
      title={t("erase.title", { name })}
      description={t("erase.description", { purgedName: t("purgedName") })}
      confirmLabel={t("erase.confirm")}
      cancelLabel={t("erase.keep")}
      destructive
      onConfirm={async () => {
        const response = await fetch(`/api/guests/${id}/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: id }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
          );
        }
        toastSuccess(t("erase.done"));
        if (body?.outcome === "deleted") router.push("/bookings");
        router.refresh();
      }}
    />
  );
}
