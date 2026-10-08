"use client";

import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";

/**
 * Erases a guest's personal data (DSGVO Art. 17) after an explicit
 * confirmation. The API wants the guest's id repeated as that confirmation.
 * A guest with bookings is anonymised and stays, so the page refreshes; one
 * without is deleted, so the page leaves for the booking list.
 */
export function EraseGuestButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={<Button variant="destructive">Erase personal data</Button>}
      title={`Erase ${name}'s personal data?`}
      description="This cannot be undone. The name is replaced with “Deleted guest”, and the email address, phone number and notes are removed, as are the notes of their bookings. The bookings themselves remain, anonymised, because they are accounting records."
      confirmLabel="Erase permanently"
      cancelLabel="Keep data"
      destructive
      onConfirm={async () => {
        const response = await fetch(`/api/guests/${id}/purge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: id }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error?.message ?? `The server answered ${response.status}.`);
        }
        toastSuccess("Personal data erased");
        if (body?.outcome === "deleted") router.push("/bookings");
        router.refresh();
      }}
    />
  );
}
