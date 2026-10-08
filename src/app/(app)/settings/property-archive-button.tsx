"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { PropertyDto } from "@/lib/properties/service";

async function post(url: string) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `The server answered ${response.status}.`);
  }
}

/**
 * Archives an active property after asking, or restores an archived one
 * straight away: restoring loses nothing, so it needs no confirmation.
 */
export function PropertyArchiveButton({ property }: { property: PropertyDto }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
            await post(`/api/properties/${property.id}/unarchive`);
            toastSuccess(`${property.name} restored`);
            router.refresh();
          } catch (error) {
            toastError(error, "Could not restore the property");
          } finally {
            setPending(false);
          }
        }}
      >
        Restore
      </Button>
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          Archive
        </Button>
      }
      title={`Archive ${property.name}?`}
      description="It disappears from property selectors, but its bookings and finances stay visible. You can restore it at any time."
      confirmLabel="Archive"
      onConfirm={async () => {
        await post(`/api/properties/${property.id}/archive`);
        toastSuccess(`${property.name} archived`);
        router.refresh();
      }}
    />
  );
}
