"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { type Conflict, describeConflict } from "@/lib/bookings/form";

type Status = "inquiry" | "confirmed" | "cancelled";

/** A failed request, with the API's message and, for a 409, what is in the way. */
class RequestError extends Error {
  constructor(
    message: string,
    readonly conflicts: Conflict[] = [],
  ) {
    super(message);
  }
}

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new RequestError(
    body?.error?.message ?? `The server answered ${response.status}.`,
    body?.error?.conflicts ?? [],
  );
}

const patchStatus = (id: string, status: Status) =>
  send(`/api/bookings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

/**
 * Moves a booking between statuses. Confirming re-checks availability on the
 * server, so an inquiry whose dates were taken since is refused, and the
 * refusal says what is in the way. Cancelling asks first and frees the dates
 * at once; a cancelled booking can be reinstated as an inquiry.
 */
export function BookingActions({ id, status }: { id: string; status: Status }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<RequestError | null>(null);

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setPending(true);
    setRefusal(null);
    try {
      await action();
      toastSuccess(done);
      router.refresh();
    } catch (error) {
      if (error instanceof RequestError && error.conflicts.length > 0) setRefusal(error);
      else toastError(error, failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "inquiry" ? (
          <Button
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              run(() => patchStatus(id, "confirmed"), "Booking confirmed", "Could not confirm")
            }
          >
            Confirm booking
          </Button>
        ) : null}
        {status === "cancelled" ? (
          <Button
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              run(
                () => patchStatus(id, "inquiry"),
                "Booking reinstated as an inquiry",
                "Could not reinstate",
              )
            }
          >
            Reinstate as inquiry
          </Button>
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={pending}>
                Cancel booking
              </Button>
            }
            title="Cancel this booking?"
            description="Its dates become free straight away. The booking is kept, marked cancelled, and can be reinstated as an inquiry later. The guest is not notified."
            confirmLabel="Cancel booking"
            cancelLabel="Keep booking"
            destructive
            onConfirm={async () => {
              await send(`/api/bookings/${id}/cancel`, { method: "POST" });
              toastSuccess("Booking cancelled");
              router.refresh();
            }}
          />
        )}
      </div>

      {refusal ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">This booking cannot be confirmed: its dates are taken.</p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.conflicts.map((conflict) => (
              <li key={`${conflict.kind}-${conflict.id}`}>
                {conflict.kind === "booking" ? (
                  <Link href={`/bookings/${conflict.id}`} className="underline">
                    {describeConflict(conflict)}
                  </Link>
                ) : (
                  describeConflict(conflict)
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1">Change the dates, or cancel the other booking first.</p>
        </div>
      ) : null}
    </div>
  );
}
